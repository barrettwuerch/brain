import dynamic from 'next/dynamic'

const TradingOffice = dynamic(() => import('@/components/trading-office'), {
  ssr: false,
  loading: () => <div style={{ color: '#fff', padding: 40 }}>Loading trading floor...</div>,
})

export default function FloorPage() {
  // client-only canvas floor
  return <TradingOffice />
}
