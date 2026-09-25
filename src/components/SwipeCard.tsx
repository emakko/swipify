import { motion, useMotionValue, useTransform, type PanInfo } from 'motion/react';
import type { Card } from '../core/deck';
import { SWIPE_DISTANCE, swipeIntent, type SwipeDirection } from './gestures';

export type { SwipeDirection } from './gestures';

const variants = {
  enter: { scale: 0.95, opacity: 0 },
  center: { scale: 1, opacity: 1 },
  exit: (direction: SwipeDirection) => ({
    x: direction === 'keep' ? 600 : -600,
    opacity: 0,
    transition: { duration: 0.3 },
  }),
};

interface Props {
  card: Card;
  direction: SwipeDirection;
  onSwipe: (direction: SwipeDirection) => void;
}

export function SwipeCard({ card, direction, onSwipe }: Props) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-300, 300], [-18, 18]);
  const keepOpacity = useTransform(x, [30, SWIPE_DISTANCE], [0, 1]);
  const removeOpacity = useTransform(x, [-SWIPE_DISTANCE, -30], [1, 0]);

  const onDragEnd = (_event: unknown, info: PanInfo) => {
    const intent = swipeIntent(info.offset.x, info.velocity.x);
    if (intent) onSwipe(intent);
  };

  return (
    <motion.article
      className="card"
      style={{ x, rotate }}
      drag="x"
      dragSnapToOrigin
      onDragEnd={onDragEnd}
      custom={direction}
      variants={variants}
      initial="enter"
      animate="center"
      exit="exit"
    >
      <motion.span className="stamp keep" style={{ opacity: keepOpacity }}>
        KEEP
      </motion.span>
      <motion.span className="stamp remove" style={{ opacity: removeOpacity }}>
        REMOVE
      </motion.span>
      {card.imageUrl ? <img src={card.imageUrl} alt="" draggable={false} /> : <div className="no-art">♪</div>}
      <div className="meta">
        <h2>{card.name}</h2>
        <p>{card.artists.join(', ')}</p>
        <p className="muted">{card.album}</p>
        {!card.isPlayable && <p className="badge">Can't play this song in your region — you can still decide.</p>}
      </div>
    </motion.article>
  );
}
