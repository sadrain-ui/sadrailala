import { useState, useEffect } from 'react'
import type { TradingPair, TradeOrder } from '../../types/trading'

interface TradeHistoryProps {
  pair: TradingPair
}

export function TradeHistory({ pair }: TradeHistoryProps) {
  const [orders, setOrders] = useState<TradeOrder[]>([])
  const [filter, setFilter] = useState<'all' | 'open' | 'closed'>('all')

  useEffect(() => {
    // Generate mock trade history
    const mockOrders: TradeOrder[] = [
      {
        id: '1001',
        symbol: pair.symbol,
        type: 'BUY',
        price: pair.lastPrice * 0.98,
        quantity: 0.5,
        filledQuantity: 0.5,
        status: 'FILLED',
        createdAt: new Date(Date.now() - 3600000),
        updatedAt: new Date(Date.now() - 3600000),
        totalValue: pair.lastPrice * 0.98 * 0.5,
        fee: (pair.lastPrice * 0.98 * 0.5) * 0.001,
      },
      {
        id: '1002',
        symbol: pair.symbol,
        type: 'SELL',
        price: pair.lastPrice * 1.02,
        quantity: 1.0,
        filledQuantity: 1.0,
        status: 'FILLED',
        createdAt: new Date(Date.now() - 7200000),
        updatedAt: new Date(Date.now() - 7200000),
        totalValue: pair.lastPrice * 1.02 * 1.0,
        fee: (pair.lastPrice * 1.02 * 1.0) * 0.001,
      },
      {
        id: '1003',
        symbol: pair.symbol,
        type: 'BUY',
        price: pair.lastPrice,
        quantity: 2.5,
        filledQuantity: 1.2,
        status: 'PARTIAL_FILLED',
        createdAt: new Date(Date.now() - 1800000),
        updatedAt: new Date(Date.now() - 900000),
        totalValue: pair.lastPrice * 1.2,
        fee: (pair.lastPrice * 1.2) * 0.001,
      },
      {
        id: '1004',
        symbol: pair.symbol,
        type: 'BUY',
        price: pair.lastPrice * 0.97,
        quantity: 0.75,
        filledQuantity: 0,
        status: 'PENDING',
        createdAt: new Date(Date.now() - 600000),
        updatedAt: new Date(Date.now() - 600000),
        totalValue: pair.lastPrice * 0.97 * 0.75,
        fee: (pair.lastPrice * 0.97 * 0.75) * 0.001,
      },
    ]

    setOrders(mockOrders)
  }, [pair])

  const filteredOrders = orders.filter((order) => {
    if (filter === 'open') return order.status === 'PENDING' || order.status === 'PARTIAL_FILLED'
    if (filter === 'closed') return order.status === 'FILLED' || order.status === 'CANCELLED'
    return true
  })

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'FILLED':
        return 'status-filled'
      case 'PARTIAL_FILLED':
        return 'status-partial'
      case 'PENDING':
        return 'status-pending'
      case 'CANCELLED':
        return 'status-cancelled'
      default:
        return ''
    }
  }

  return (
    <div className="trade-history">
      <div className="history-header">
        <h3>Order History</h3>
        <div className="filter-buttons">
          <button
            className={`filter-btn ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >
            All
          </button>
          <button
            className={`filter-btn ${filter === 'open' ? 'active' : ''}`}
            onClick={() => setFilter('open')}
          >
            Open ({orders.filter((o) => o.status === 'PENDING' || o.status === 'PARTIAL_FILLED').length})
          </button>
          <button
            className={`filter-btn ${filter === 'closed' ? 'active' : ''}`}
            onClick={() => setFilter('closed')}
          >
            Closed ({orders.filter((o) => o.status === 'FILLED' || o.status === 'CANCELLED').length})
          </button>
        </div>
      </div>

      <div className="history-table">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Pair</th>
              <th>Type</th>
              <th>Price</th>
              <th>Amount</th>
              <th>Filled</th>
              <th>Total</th>
              <th>Fee</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredOrders.length > 0 ? (
              filteredOrders.map((order) => (
                <tr key={order.id}>
                  <td className="date">
                    {order.createdAt.toLocaleDateString()} {order.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className="pair">{order.symbol}</td>
                  <td className={`type ${order.type.toLowerCase()}`}>{order.type}</td>
                  <td className="price">${order.price.toFixed(2)}</td>
                  <td className="amount">{order.quantity.toFixed(4)}</td>
                  <td className="filled">
                    {order.filledQuantity.toFixed(4)}
                    <span className="fill-percent">
                      {((order.filledQuantity / order.quantity) * 100).toFixed(0)}%
                    </span>
                  </td>
                  <td className="total">${order.totalValue.toFixed(2)}</td>
                  <td className="fee">${order.fee.toFixed(4)}</td>
                  <td className={`status ${getStatusColor(order.status)}`}>
                    <span className="status-badge">{order.status}</span>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={9} style={{ textAlign: 'center', padding: '20px', color: '#999' }}>
                  No orders found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
