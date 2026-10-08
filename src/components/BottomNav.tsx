import { CalendarDots, ChartLineUp, GearSix, Lightning } from '@phosphor-icons/react';
import { useLocation } from 'wouter';
import { TabBar } from '../ui/TabBar';

export function BottomNav() {
  const [location] = useLocation();
  const today = location === '/' || ['/session', '/ankel', '/mobilitet', '/forslag'].some((p) => location.startsWith(p));
  return (
    <TabBar
      tabs={[
        { href: '/', label: 'I dag', icon: Lightning, active: today },
        { href: '/uge', label: 'Uge', icon: CalendarDots, active: location.startsWith('/uge') },
        { href: '/historik', label: 'Historik', icon: ChartLineUp, active: location.startsWith('/historik') },
        { href: '/indstillinger', label: 'Indstillinger', icon: GearSix, active: location.startsWith('/indstillinger') },
      ]}
    />
  );
}
