'use client'
// Support exports for ShopViews (PaymentPanel re-export + shipment card)
export { PaymentPanel } from '../../shared/clinical'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { JalaliDate } from '../../shared/atoms'
import { Truck } from 'lucide-react'

export function ShipmentCard({ shipment }: { shipment: { id: string; method: string; status: string; driverName?: string; trackingCode?: string; shippingDate?: string; deliveryDate?: string; cost?: number } }) {
  const methodFa: Record<string, string> = { MOTORCYCLE: 'پیک موتوری', CAR: 'خودرو', POST: 'پست' }
  return (
    <Card className="bg-muted/40">
      <CardContent className="p-3 flex items-center gap-3 flex-wrap text-sm">
        <Truck size={16} className="text-primary" />
        <span>{methodFa[shipment.method] || shipment.method}</span>
        <Badge variant={shipment.status === 'DELIVERED' ? 'secondary' : 'outline'}>{shipment.status}</Badge>
        {shipment.trackingCode && <span className="text-xs text-muted-foreground" dir="ltr">#: {shipment.trackingCode}</span>}
        <span className="ms-auto text-xs text-muted-foreground">
          {shipment.deliveryDate ? <><JalaliDate date={shipment.deliveryDate} /> ✓</> : shipment.shippingDate ? <JalaliDate date={shipment.shippingDate} /> : ''}
        </span>
      </CardContent>
    </Card>
  )
}
