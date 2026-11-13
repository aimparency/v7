import { ref } from 'vue'

// Crypto wallets in this browser, found the standard way (EIP-6963: each
// wallet announces itself) and talked to through their own interface
// (EIP-1193). Nothing here goes through a service: the wallet signs a message
// the Aimparency server wrote, and that server checks the signature.
type Provider = { request(args: { method: string, params?: unknown[] }): Promise<unknown> }
export type Wallet = { id: string, name: string, provider: Provider }

type Announcement = CustomEvent<{ info: { uuid: string, name: string }, provider: Provider }>

const wallets = ref<Wallet[]>([])
let listening = false

/** The wallets of this browser; the list fills as they announce themselves. */
export function browserWallets() {
  if (!listening) {
    listening = true
    window.addEventListener('eip6963:announceProvider', (event) => {
      const { info, provider } = (event as Announcement).detail
      if (!wallets.value.some(wallet => wallet.id === info.uuid)) wallets.value.push({ id: info.uuid, name: info.name, provider })
    })
    window.dispatchEvent(new Event('eip6963:requestProvider'))
    // Older wallets only put themselves on the page.
    const injected = (window as { ethereum?: Provider }).ethereum
    if (wallets.value.length === 0 && injected) wallets.value.push({ id: 'injected', name: 'Browser wallet', provider: injected })
  }
  return wallets
}

const toHex = (text: string) => `0x${[...new TextEncoder().encode(text)].map(byte => byte.toString(16).padStart(2, '0')).join('')}`

/** Asks the wallet for its account and has it sign the message the server writes for that account. */
export async function signWithWallet(
  wallet: Wallet,
  challenge: (address: string, chainId: number) => Promise<string>
): Promise<{ message: string, signature: string }> {
  const [address] = await wallet.provider.request({ method: 'eth_requestAccounts' }) as string[]
  if (!address) throw new Error('The wallet gave no account.')
  const chainId = Number.parseInt(await wallet.provider.request({ method: 'eth_chainId' }) as string, 16)
  const message = await challenge(address, chainId)
  const signature = await wallet.provider.request({ method: 'personal_sign', params: [toHex(message), address] }) as string
  return { message, signature }
}
