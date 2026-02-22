import RadarrAPI, { type RadarrMovie } from '@server/api/servarr/radarr';
import SonarrAPI, { type SonarrSeries } from '@server/api/servarr/sonarr';
import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';

export type RedownloadPayload = {
  is4k?: boolean;
  seasons?: number[];
  episodeIds?: number[];
};

interface EpisodeInfo {
  id: number;
  seasonNumber: number;
  monitored: boolean;
}

export class RedownloadError extends Error {
  public status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

class RedownloadService {
  public async redownload(
    mediaId: number,
    payload: RedownloadPayload
  ): Promise<{ success: boolean; message: string }> {
    const mediaRepository = getRepository(Media);
    const media = await mediaRepository.findOne({
      where: { id: mediaId },
      relations: { requests: true },
    });

    if (!media) {
      throw new RedownloadError(404, 'Media does not exist.');
    }

    const is4k = Boolean(payload.is4k);
    const serviceId = media[is4k ? 'serviceId4k' : 'serviceId'];
    const externalServiceId =
      media[is4k ? 'externalServiceId4k' : 'externalServiceId'];

    if (serviceId == null || externalServiceId == null) {
      throw new RedownloadError(
        400,
        `Media is not configured in ${
          media.mediaType === MediaType.MOVIE ? 'Radarr' : 'Sonarr'
        }.`
      );
    }

    const settings = getSettings();

    if (media.mediaType === MediaType.MOVIE) {
      return this.redownloadMovie(
        media,
        settings,
        serviceId,
        externalServiceId,
        is4k
      );
    }

    return this.redownloadSeries(
      settings,
      serviceId,
      externalServiceId,
      payload
    );
  }

  private async redownloadMovie(
    media: Media,
    settings: ReturnType<typeof getSettings>,
    serviceId: number,
    movieId: number,
    is4k: boolean
  ): Promise<{ success: boolean; message: string }> {
    const radarrSettings = settings.radarr.find((r) => r.id === serviceId);

    if (!radarrSettings) {
      throw new RedownloadError(500, 'Radarr server configuration not found.');
    }

    const radarr = new RadarrAPI({
      apiKey: radarrSettings.apiKey,
      url: RadarrAPI.buildUrl(radarrSettings, '/api/v3'),
    });

    try {
      const movie = await radarr.getMovie({ id: movieId });

      await this.ensureMovieMonitored(radarr, movie);

      if (movie.hasFile && movie.movieFile?.id) {
        logger.info('Deleting existing movie file before re-download', {
          label: 'Media',
          movieId,
          movieFileId: movie.movieFile.id,
        });
        await radarr.deleteMovieFile(movie.movieFile.id);
      }
    } catch (e) {
      logger.warn(
        'Could not prepare movie for re-download, continuing with search',
        { label: 'Media', errorMessage: e.message }
      );
    }

    await radarr.searchMovie(movieId);

    const mediaRepository = getRepository(Media);
    media[is4k ? 'status4k' : 'status'] = MediaStatus.PROCESSING;
    await mediaRepository.save(media);

    return { success: true, message: 'Movie re-download initiated.' };
  }

  private async redownloadSeries(
    settings: ReturnType<typeof getSettings>,
    serviceId: number,
    seriesId: number,
    payload: RedownloadPayload
  ): Promise<{ success: boolean; message: string }> {
    const sonarrSettings = settings.sonarr.find((s) => s.id === serviceId);

    if (!sonarrSettings) {
      throw new RedownloadError(500, 'Sonarr server configuration not found.');
    }

    const sonarr = new SonarrAPI({
      apiKey: sonarrSettings.apiKey,
      url: SonarrAPI.buildUrl(sonarrSettings, '/api/v3'),
    });

    await this.ensureSeriesMonitored(sonarr, seriesId, payload);
    await this.deleteExistingEpisodeFiles(sonarr, seriesId);

    return this.searchSonarr(sonarr, seriesId, payload);
  }

  private async ensureMovieMonitored(
    radarr: RadarrAPI,
    movie: RadarrMovie
  ): Promise<void> {
    if (!movie.monitored) {
      logger.info(
        'Movie is not monitored in Radarr, setting to monitored before re-download',
        { label: 'Media', movieId: movie.id }
      );
      await radarr.updateMovie({ ...movie, monitored: true });
    }
  }

  private async ensureSeriesMonitored(
    sonarr: SonarrAPI,
    seriesId: number,
    payload: RedownloadPayload
  ): Promise<void> {
    try {
      const series = await sonarr.getSeriesById(seriesId);
      const episodes = await sonarr.getEpisodes(seriesId);

      let seriesUpdated = !series.monitored;
      if (!series.monitored) {
        logger.info(
          'Series is not monitored in Sonarr, setting to monitored before re-download',
          { label: 'Media', seriesId }
        );
        series.monitored = true;
      }

      if (payload.seasons && payload.seasons.length > 0) {
        seriesUpdated =
          this.ensureSeasonsMonitored(series, payload.seasons, seriesId) ||
          seriesUpdated;
        await this.ensureEpisodesMonitoredBySeasons(
          sonarr,
          episodes,
          payload.seasons,
          seriesId
        );
      } else if (payload.episodeIds && payload.episodeIds.length > 0) {
        seriesUpdated =
          this.ensureSeasonsMonitoredForEpisodes(
            series,
            episodes,
            payload.episodeIds,
            seriesId
          ) || seriesUpdated;
        await this.ensureEpisodesMonitoredByIds(
          sonarr,
          episodes,
          payload.episodeIds,
          seriesId
        );
      } else {
        seriesUpdated =
          this.ensureAllSeasonsMonitored(series, seriesId) || seriesUpdated;
        await this.ensureAllEpisodesMonitored(sonarr, episodes, seriesId);
      }

      if (seriesUpdated) {
        await sonarr.updateSeries(series);
      }
    } catch (e) {
      logger.warn(
        'Could not verify/update monitoring status, continuing with search',
        { label: 'Media', errorMessage: e.message }
      );
    }
  }

  private ensureSeasonsMonitored(
    series: SonarrSeries,
    seasonNumbers: number[],
    seriesId: number
  ): boolean {
    let updated = false;
    for (const season of series.seasons) {
      if (seasonNumbers.includes(season.seasonNumber) && !season.monitored) {
        logger.info(
          'Season is not monitored in Sonarr, setting to monitored before re-download',
          { label: 'Media', seriesId, seasonNumber: season.seasonNumber }
        );
        season.monitored = true;
        updated = true;
      }
    }
    return updated;
  }

  private ensureAllSeasonsMonitored(
    series: SonarrSeries,
    seriesId: number
  ): boolean {
    let updated = false;
    for (const season of series.seasons) {
      if (season.seasonNumber > 0 && !season.monitored) {
        logger.info(
          'Season is not monitored in Sonarr, setting to monitored before re-download',
          { label: 'Media', seriesId, seasonNumber: season.seasonNumber }
        );
        season.monitored = true;
        updated = true;
      }
    }
    return updated;
  }

  private ensureSeasonsMonitoredForEpisodes(
    series: SonarrSeries,
    episodes: EpisodeInfo[],
    episodeIds: number[],
    seriesId: number
  ): boolean {
    const targetEpisodes = episodes.filter((ep) => episodeIds.includes(ep.id));
    const seasonNumbers = [
      ...new Set(targetEpisodes.map((ep) => ep.seasonNumber)),
    ];
    return this.ensureSeasonsMonitored(series, seasonNumbers, seriesId);
  }

  private async ensureEpisodesMonitoredBySeasons(
    sonarr: SonarrAPI,
    episodes: EpisodeInfo[],
    seasonNumbers: number[],
    seriesId: number
  ): Promise<void> {
    const unmonitoredIds = episodes
      .filter((ep) => seasonNumbers.includes(ep.seasonNumber) && !ep.monitored)
      .map((ep) => ep.id);

    if (unmonitoredIds.length > 0) {
      logger.info(
        'Episodes in target season(s) are not monitored, setting to monitored before re-download',
        { label: 'Media', seriesId, episodeCount: unmonitoredIds.length }
      );
      await sonarr.monitorEpisodes(unmonitoredIds, true);
    }
  }

  private async ensureEpisodesMonitoredByIds(
    sonarr: SonarrAPI,
    episodes: EpisodeInfo[],
    episodeIds: number[],
    seriesId: number
  ): Promise<void> {
    const unmonitoredIds = episodes
      .filter((ep) => episodeIds.includes(ep.id) && !ep.monitored)
      .map((ep) => ep.id);

    if (unmonitoredIds.length > 0) {
      logger.info(
        'Episodes are not monitored in Sonarr, setting to monitored before re-download',
        { label: 'Media', seriesId, episodeIds: unmonitoredIds }
      );
      await sonarr.monitorEpisodes(unmonitoredIds, true);
    }
  }

  private async ensureAllEpisodesMonitored(
    sonarr: SonarrAPI,
    episodes: EpisodeInfo[],
    seriesId: number
  ): Promise<void> {
    const unmonitoredIds = episodes
      .filter((ep) => ep.seasonNumber > 0 && !ep.monitored)
      .map((ep) => ep.id);

    if (unmonitoredIds.length > 0) {
      logger.info(
        'Episodes are not monitored in Sonarr, setting to monitored before re-download',
        { label: 'Media', seriesId, episodeCount: unmonitoredIds.length }
      );
      await sonarr.monitorEpisodes(unmonitoredIds, true);
    }
  }

  private async deleteExistingEpisodeFiles(
    sonarr: SonarrAPI,
    seriesId: number
  ): Promise<void> {
    try {
      const episodeFileIds = await sonarr.getEpisodeFiles(seriesId);

      if (episodeFileIds.length > 0) {
        logger.info('Deleting existing episode files before re-download', {
          label: 'Media',
          seriesId,
          fileCount: episodeFileIds.length,
        });
        await sonarr.deleteEpisodeFiles(episodeFileIds);
      }
    } catch (e) {
      logger.warn(
        'Could not delete existing episode files, continuing with search',
        { label: 'Media', errorMessage: e.message }
      );
    }
  }

  private async searchSonarr(
    sonarr: SonarrAPI,
    seriesId: number,
    payload: RedownloadPayload
  ): Promise<{ success: boolean; message: string }> {
    if (payload.seasons && payload.seasons.length > 0) {
      for (const seasonNumber of payload.seasons) {
        await sonarr.searchSeason(seriesId, seasonNumber);
      }
      return {
        success: true,
        message: `Re-download initiated for ${payload.seasons.length} season(s).`,
      };
    }

    if (payload.episodeIds && payload.episodeIds.length > 0) {
      await sonarr.searchEpisodes(payload.episodeIds);
      return {
        success: true,
        message: `Re-download initiated for ${payload.episodeIds.length} episode(s).`,
      };
    }

    await sonarr.searchSeries(seriesId);
    return { success: true, message: 'Series re-download initiated.' };
  }
}

export default RedownloadService;
