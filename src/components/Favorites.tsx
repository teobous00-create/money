import { useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useStore } from '../lib/store';
import { catStyle } from '../lib/calc';
import { haptic, num } from '../lib/format';
import { Icon } from './ui';
import { addFromFavorite, favoriteAlive, favoriteLabel, openFavorite, useFavorites } from '../lib/favorites';
import type { Favorite } from '../lib/types';

const DOUBLE_MS = 280;

/** Row of favorite entries: tap = add it for today, double tap = open it filled in to change something. */
export function FavoritesBar() {
  const favs = useFavorites();
  const cats = useStore(s => s.categories);
  const accs = useStore(s => s.accounts);
  void accs; // re-render when accounts change (alive check)
  const live = favs.filter(favoriteAlive);
  return (
    <AnimatePresence initial={false}>
      {live.length > 0 && (
        <motion.div className="favs" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
          <div className="favs-row">
            {live.map(f => <Chip key={f.id} f={f} color={f.type === 'transfer' ? '#64748B' : catStyle(f.category_id, cats).color} icon={f.type === 'transfer' ? 'circle' : catStyle(f.category_id, cats).icon} />)}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Chip({ f, color, icon }: { f: Favorite; color: string; icon: string }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tap = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; haptic(6); openFavorite(f); return; }
    timer.current = setTimeout(() => { timer.current = null; haptic(10); addFromFavorite(f); }, DOUBLE_MS);
  };
  return (
    <motion.button className="fav" whileTap={{ scale: 0.94 }} onClick={tap} style={{ ['--c' as string]: color }} aria-label={`Add ${favoriteLabel(f)}`}>
      <span className="fav-ico"><Icon name={icon} size={16} /></span>
      <span className="fav-name">{favoriteLabel(f)}</span>
      <span className="fav-amt num">{num(f.amount)}€</span>
    </motion.button>
  );
}

