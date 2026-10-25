import { cookieStorage, createStorage, http } from '@wagmi/core'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { bsc, bscTestnet } from '@reown/appkit/networks'
import type { AppKitNetwork } from '@reown/appkit/networks'

export const projectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID
if (!projectId) throw new Error('NEXT_PUBLIC_REOWN_PROJECT_ID is not defined')

// FarFlappy AI Arena runs on BNB Chain (56). BSC Testnet (97) is for dev/testing only.
export const networks: [AppKitNetwork, ...AppKitNetwork[]] = [bsc, bscTestnet]

export const wagmiAdapter = new WagmiAdapter({
  storage: createStorage({ storage: cookieStorage }),
  ssr: true,
  projectId,
  networks,
  transports: { [bsc.id]: http(), [bscTestnet.id]: http() },
})

export const wagmiConfig = wagmiAdapter.wagmiConfig
