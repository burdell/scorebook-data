import { GameOutput } from 'scorekeepr'

import {
  SeriesBuildConfig,
  SeriesConfig,
  SeriesIdFn,
  BuildConfig,
} from '../build.types'
import { ListGame, Series, GameList, SeriesGames } from '../build.types'
import { generateGames, convertToListGame } from '.'

type SeasonSeries = {
  seriesName?: string
  homeTeam: string
  visitingTeam: string
  games: ListGame[]
  dateStart: string
  dateEnd: string
  seriesId: string
}

function startSeries(
  seriesId: string,
  game: ListGame,
  seriesName: string | undefined,
): SeasonSeries {
  return {
    seriesName,
    homeTeam: game.homeTeam,
    visitingTeam: game.visitingTeam,
    games: [game],
    dateStart: game.date,
    dateEnd: '',
    seriesId,
  }
}

function endSeries(series: SeasonSeries) {
  const lastGame = series.games[series.games.length - 1]
  series.dateEnd = lastGame.date
}

function buildSeries(
  idFn: SeriesIdFn,
  games: ListGame[],
  seriesName: string | undefined,
): SeasonSeries[] {
  const series: SeasonSeries[] = []
  games.forEach((game) => {
    if (!series[series.length - 1]) {
      const seriesId = idFn(game.matchup, game.id)
      series.push(startSeries(seriesId, game, seriesName))
      return
    }

    const currentSeries = series[series.length - 1]
    const currentGames = currentSeries.games

    const currentSeriesId = currentSeries.seriesId
    const gameSeriesId = idFn(game.matchup, currentSeries.games[0].id)

    if (currentSeriesId === gameSeriesId) {
      currentGames.push(game)
    } else {
      endSeries(currentSeries)
      series.push(startSeries(idFn(game.matchup, game.id), game, seriesName))
    }

    endSeries(currentSeries)
  })

  return series
}

async function generateSeries(
  seriesConfig: SeriesConfig,
  buildConfig: BuildConfig,
) {
  const fullGames = await generateGames(seriesConfig.retrosheetFiles)
  const listGames = fullGames.map((game) =>
    convertToListGame(game, buildConfig),
  )
  const seasonSeries = buildSeries(
    seriesConfig.seriesId,
    listGames,
    seriesConfig.seriesName,
  )

  return { seasonSeries, fullGames }
}

type SeriesData = {
  name: string
  urlSlug: string
  series: Series[]
  targetTeam?: string
}

function getTargettWinCounts(games: ListGame[], targetTeam: string) {
  let targetTeamWins = 0
  let otherTeamWins = 0
  games.forEach(({ visitingScore, homeScore, homeTeam, visitingTeam }) => {
    if (visitingScore > homeScore) {
      if (targetTeam === visitingTeam) targetTeamWins += 1
      else otherTeamWins += 1
    } else if (homeScore > visitingScore) {
      if (targetTeam === homeTeam) targetTeamWins += 1
      else otherTeamWins += 1
    }
  })

  return { targetTeamWins, otherTeamWins }
}

function getWinCounts(games: ListGame[]) {
  let otherTeamWins = 0
  let targetTeamWins = 0
  games.forEach(({ visitingScore, homeScore }) => {
    if (visitingScore > homeScore) {
      targetTeamWins += 1
    } else if (homeScore > visitingScore) {
      otherTeamWins += 1
    }
  })

  return { otherTeamWins, targetTeamWins }
}

export async function buildSeriesList(configList: SeriesBuildConfig[]) {
  const seasonGameLists: GameList[] = []
  const series: SeriesData[] = []
  const seriesGames: SeriesGames[] = []
  let fullGames: GameOutput[] = []

  const configs = configList.map(async (config) => {
    seasonGameLists.push({
      name: config.name,
      description: config.description,
      listId: config.urlSlug,
      type: config.type === 'series' ? 'series' : 'series-group',
    })

    const generatedSeries = await Promise.all(
      config.series.map((s) => generateSeries(s, config)),
    )

    const seriesData: SeriesData = {
      name: config.name,
      urlSlug: config.urlSlug,
      targetTeam: config.targetTeam,
      series: [],
    }
    generatedSeries.forEach((s) => {
      fullGames = fullGames.concat(s.fullGames)

      s.seasonSeries.map(
        ({
          dateEnd,
          dateStart,
          seriesId,
          homeTeam,
          visitingTeam,
          games,
          seriesName,
        }) => {
          const winCounts = seriesData.targetTeam
            ? getTargettWinCounts(games, seriesData.targetTeam)
            : getWinCounts(games)

          seriesData.series.push({
            seriesName,
            homeTeam,
            visitingTeam,
            seriesId,
            endDate: dateEnd,
            startDate: dateStart,
            targetTeam: seriesData.targetTeam,
            ...winCounts,
          })
          seriesGames.push({
            urlSlug: seriesId,
            games,
            seriesInfo: {
              seriesName,
              homeTeam,
              visitingTeam,
              startDate: dateStart,
              endDate: dateEnd,
            },
          })
        },
      )
    })

    series.push(seriesData)
  })

  await Promise.all(configs)

  return { seasonGameLists, fullGames, series, seriesGames }
}
