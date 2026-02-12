import RadarrAPI from '@server/api/servarr/radarr';
import SonarrAPI from '@server/api/servarr/sonarr';
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
      const radarrSettings = settings.radarr.find((r) => r.id === serviceId);

      if (!radarrSettings) {
        throw new RedownloadError(
          500,
          'Radarr server configuration not found.'
        );
      }

      const radarr = new RadarrAPI({
        apiKey: radarrSettings.apiKey,
        url: RadarrAPI.buildUrl(radarrSettings, '/api/v3'),
      });

      try {
        const movie = await radarr.getMovie({ id: externalServiceId });

        if (movie.hasFile && movie.movieFile?.id) {
          logger.info('Deleting existing movie file before re-download', {
            label: 'Media',
            movieId: externalServiceId,
            movieFileId: movie.movieFile.id,
          });
          await radarr.deleteMovieFile(movie.movieFile.id);
        }
      } catch (e) {
        logger.warn(
          'Could not delete existing movie file, continuing with search',
          {
            label: 'Media',
            errorMessage: e.message,
          }
        );
      }

      await radarr.searchMovie(externalServiceId);

      media[is4k ? 'status4k' : 'status'] = MediaStatus.PROCESSING;
      await mediaRepository.save(media);

      return {
        success: true,
        message: 'Movie re-download initiated.',
      };
    }

    const sonarrSettings = settings.sonarr.find((s) => s.id === serviceId);

    if (!sonarrSettings) {
      throw new RedownloadError(500, 'Sonarr server configuration not found.');
    }

    const sonarr = new SonarrAPI({
      apiKey: sonarrSettings.apiKey,
      url: SonarrAPI.buildUrl(sonarrSettings, '/api/v3'),
    });

    try {
      const episodeFileIds = await sonarr.getEpisodeFiles(externalServiceId);

      if (episodeFileIds.length > 0) {
        logger.info('Deleting existing episode files before re-download', {
          label: 'Media',
          seriesId: externalServiceId,
          fileCount: episodeFileIds.length,
        });
        await sonarr.deleteEpisodeFiles(episodeFileIds);
      }
    } catch (e) {
      logger.warn(
        'Could not delete existing episode files, continuing with search',
        {
          label: 'Media',
          errorMessage: e.message,
        }
      );
    }

    if (payload.seasons && payload.seasons.length > 0) {
      for (const seasonNumber of payload.seasons) {
        await sonarr.searchSeason(externalServiceId, seasonNumber);
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

    await sonarr.searchSeries(externalServiceId);

    return {
      success: true,
      message: 'Series re-download initiated.',
    };
  }
}

export default RedownloadService;
