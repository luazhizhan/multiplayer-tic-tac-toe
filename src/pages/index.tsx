import Layout from '@/components/Layout'
import { auth, database } from '@/helpers/firebaseConfig'
import { CheckCircleIcon as CheckCircleOutlineIcon } from '@heroicons/react/24/outline'
import {
  CheckCircleIcon,
  HashtagIcon,
  TrophyIcon,
} from '@heroicons/react/24/solid'
import { signInAnonymously, updateProfile } from 'firebase/auth'
import {
  get,
  limitToFirst,
  off,
  onChildAdded,
  onChildRemoved,
  query,
  ref,
  remove,
  set,
} from 'firebase/database'
import { nanoid } from 'nanoid'
import { useRouter } from 'next/router'
import { FormEvent, useEffect, useState } from 'react'
import CrownIcon from '../components/icons/Crown'

type Game = {
  id: string
  player1: string
  player2: string
  state: 'Player1' | 'Player2' | 'Draw' | 'Incomplete'
}

type GameRoom = {
  playerId: string
  nickname: string
  createdAt: number
}

export default function Home() {
  const router = useRouter()
  const [nickname, setNickname] = useState('')
  const [loading, setLoading] = useState(false)
  const [pastGames, setPastGames] = useState<Game[]>([])
  const [gameRooms, setGameRooms] = useState<GameRoom[]>([])
  const [selectedGameRoom, setSelectedGameRoom] = useState<
    GameRoom | undefined
  >(undefined)
  const waitingRoomRef = query(ref(database, 'waitingRooms'))

  useEffect(() => {
    onChildRemoved(waitingRoomRef, (snapshot) => {
      const gameRoom = snapshot.val()
      setGameRooms((prev) =>
        prev.filter((room) => room.playerId !== gameRoom.playerId)
      )
      setSelectedGameRoom((prev) => {
        if (prev?.playerId === gameRoom.playerId) return undefined
        return prev
      })
    })

    onChildAdded(waitingRoomRef, (snapshot) => {
      const gameRoom = snapshot.val()
      setGameRooms((prev) => {
        if (prev.some((room) => room.playerId === gameRoom.playerId))
          return prev
        return [...prev, gameRoom]
      })
    })

    return () => {
      off(waitingRoomRef, 'child_removed')
      off(waitingRoomRef, 'child_added')
    }
  }, [selectedGameRoom, gameRooms, waitingRoomRef])

  useEffect(() => {
    const readPastGamesData = async () => {
      const gameRef = query(ref(database, 'games'), limitToFirst(50))

      const snapshot = await get(gameRef)
      if (snapshot.exists()) {
        const data = snapshot.val()
        const formattedData: Game[] = Object.keys(data)
          .filter((id) => data[id].playing === false)
          .sort((a, b) => data[b].createdAt - data[a].createdAt)
          .map((id) => {
            const game = data[id]
            const state = (() => {
              if (game.state === 'Incomplete') return 'Incomplete'
              if (game.state === 'Draw') return 'Draw'
              if (game[game.state[0]] === game.user1Symbol) return 'Player1'
              return 'Player2'
            })()

            return {
              id,
              player1: game.user1Nickname,
              player2: game.user2Nickname,
              state,
            }
          })
        setPastGames(formattedData)
      }
    }

    const readGameRoomsData = async () => {
      const snapshot = await get(waitingRoomRef)
      if (snapshot.exists()) {
        const data = snapshot.val()
        const formattedData: GameRoom[] = Object.keys(data)
          .sort((a, b) => data[b].createdAt - data[a].createdAt)
          .map((playerId) => {
            const game = data[playerId]
            return {
              playerId,
              nickname: game.nickname,
              createdAt: game.createdAt,
            }
          })
        setGameRooms(formattedData)
      }
    }

    readPastGamesData()
    readGameRoomsData()
  }, [waitingRoomRef])

  const onPlayClick = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    try {
      setLoading(true)
      if (!auth.currentUser) {
        await signInAnonymously(auth)
      }
      const user = auth.currentUser
      if (!user) throw new Error('Cannot sign in anonymously')

      await updateProfile(user, {
        displayName: nickname,
      })

      if (selectedGameRoom) {
        const gameId = nanoid(8)
        await set(ref(database, 'games/' + gameId), {
          id: gameId,
          user1Id: user.uid,
          user1Nickname: nickname,
          user1Symbol: 'o',
          user1Status: 'Playing',
          user2Id: selectedGameRoom.playerId,
          user2Nickname: selectedGameRoom.nickname,
          user2Symbol: 'x',
          user2Status: 'Playing',
          turn: 'o',
          createdAt: Date.now(),
          state: 'Playing',
          playing: true,
        })
        await remove(ref(database, 'waitingRooms/' + selectedGameRoom.playerId))
        router.push('/game/' + gameId)

        return
      }

      await set(ref(database, 'waitingRooms/' + user.uid), {
        nickname,
        playerId: user.uid,
        createdAt: Date.now(),
      })
      router.push('/finding')
    } catch (error) {
      alert('An error has occur. Please try again later.')
      const user = auth.currentUser
      if (user) {
        await remove(ref(database, 'waitingRooms/' + user.uid))
      }
      setLoading(false)
    }
  }

  const pastGameArialLabel = (game: Game) => {
    const label = `${game.player1} verses ${game.player2}`
    if (game.state === 'Player1') return `${label} and ${game.player1} won`
    if (game.state === 'Player2') return `${label} and ${game.player2} won`
    if (game.state === 'Draw') return `${label} and it was a draw`
    return `${label} and it was incomplete`
  }

  const buttonText = () => {
    if (selectedGameRoom && loading) {
      return `Joining ${selectedGameRoom.nickname} game...`
    }
    if (!selectedGameRoom && loading) {
      return `Creating a new game...`
    }
    if (selectedGameRoom) {
      return `Join ${selectedGameRoom.nickname} game`
    }
    return 'Create a new game'
  }

  return (
    <Layout title="Tic Tac Toe">
      <>
        <h1 className="mb-2 text-center text-2xl font-bold tracking-tight">
          Tic Tac Toe
        </h1>

        <h2 className="font-medium flex text-lg justify-start gap-2 items-center">
          <TrophyIcon className="w-4 h-4 text-amber-400" />
          <span>Past Games</span>
        </h2>
        <hr className="h-[0.5px] my-2 bg-gray-200 border-0 dark:bg-gray-700" />

        {/* Past games */}
        <section className="mb-3 max-h-40 overflow-auto">
          {pastGames.map((game) => (
            <button
              key={game.id}
              onClick={() => router.push(`/past-game/${game.id}`)}
              aria-label={pastGameArialLabel(game)}
              className="flex justify-between items-center mb-2 p-2 text-lg w-full hover:bg-gray-50"
            >
              <div className="flex gap-2 items-center">
                <span className="font-medium">{game.player1}</span>
                <span>vs.</span>
                <span className="font-medium">{game.player2}</span>
              </div>
              <div className="flex gap-2 items-center">
                {(game.state === 'Player1' || game.state === 'Player2') && (
                  <CrownIcon height={16} width={16} fill={'#fbbf24'} />
                )}
                {game.state === 'Player1' && (
                  <span aria-disabled="true" className="font-medium">
                    {game.player1}
                  </span>
                )}
                {game.state === 'Player2' && (
                  <span aria-disabled="true" className="font-medium">
                    {game.player2}
                  </span>
                )}
                {(game.state === 'Incomplete' || game.state === 'Draw') && (
                  <span aria-disabled="true" className="font-medium">
                    {game.state}
                  </span>
                )}
              </div>
            </button>
          ))}
          {pastGames.length === 0 && (
            <p className="text-gray-500">No games found</p>
          )}
        </section>

        <h2 className="font-medium flex text-lg justify-start gap-2 items-center">
          <HashtagIcon className="w-4 h-4 text-teal-700" />
          <span>Find a game</span>
        </h2>
        <hr className="h-[0.5px] my-2 bg-gray-200 border-0 dark:bg-gray-700" />
        <section className="max-h-40 overflow-auto">
          {gameRooms.map((gameRoom) => (
            <button
              key={gameRoom.playerId}
              onClick={() =>
                setSelectedGameRoom((prev) => {
                  if (prev?.playerId === gameRoom.playerId) return undefined
                  return gameRoom
                })
              }
              aria-label={`Join ${gameRoom.nickname}'s game`}
              className="flex gap-2 items-center mb-2 p-2 text-lg w-full hover:bg-gray-50"
            >
              {selectedGameRoom?.playerId === gameRoom.playerId ? (
                <CheckCircleIcon className="w-7 h-7  text-teal-500" />
              ) : (
                <CheckCircleOutlineIcon className="w-7 h-7  text-teal-500" />
              )}
              <div className="flex pb-[0.2rem] gap-2 items-center">
                <span className="font-medium">{gameRoom.nickname}&apos;s</span>
                <span>Game Room</span>
              </div>
            </button>
          ))}
        </section>

        <form onSubmit={onPlayClick}>
          <div className="mb-2">
            <label
              aria-hidden="true"
              htmlFor="nickname"
              className="block mb-2 text-sm font-medium text-gray-900 dark:text-white"
            >
              Nickname
            </label>
            <input
              aria-label="Enter your nickname"
              aria-required="true"
              required={true}
              type="text"
              id="nickname"
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-teal-500 focus:border-teal-500 block w-full p-2.5"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full focus:outline-none text-white bg-teal-700 hover:bg-teal-800 focus:ring-4 focus:ring-teal-300 font-medium rounded-md text-sm px-5 py-2.5 mb-2"
          >
            {buttonText()}
          </button>
        </form>
      </>
    </Layout>
  )
}
