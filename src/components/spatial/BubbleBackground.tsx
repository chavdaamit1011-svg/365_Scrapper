'use client';

import React, { useEffect, useState, useRef } from 'react';
import { motion, useMotionValue, useSpring } from 'framer-motion';

interface ColorfulBubble {
  id: number;
  size: number;
  initialX: number;
  initialY: number;
  duration: number;
  delay: number;
  colorGradient: string;
  glowColor: string;
}

export const BubbleBackground: React.FC = () => {
  const [bubbles, setBubbles] = useState<ColorfulBubble[]>([]);
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  // Smooth mouse coordinates for parallax / hover deflection
  const springX = useSpring(mouseX, { stiffness: 60, damping: 20 });
  const springY = useSpring(mouseY, { stiffness: 60, damping: 20 });

  useEffect(() => {
    // 8 Colorful, radiant bubbles with iridescent light-theme gradients
    const generated: ColorfulBubble[] = [
      {
        id: 1,
        size: 320,
        initialX: 8,
        initialY: 10,
        duration: 20,
        delay: 0,
        colorGradient: 'radial-gradient(circle at 35% 30%, rgba(255, 255, 255, 0.95), rgba(56, 189, 248, 0.5) 45%, rgba(14, 165, 233, 0.25) 80%, transparent 100%)',
        glowColor: 'rgba(56, 189, 248, 0.28)',
      },
      {
        id: 2,
        size: 240,
        initialX: 82,
        initialY: 15,
        duration: 18,
        delay: 1,
        colorGradient: 'radial-gradient(circle at 35% 30%, rgba(255, 255, 255, 0.95), rgba(168, 85, 247, 0.45) 50%, rgba(236, 72, 153, 0.2) 85%, transparent 100%)',
        glowColor: 'rgba(168, 85, 247, 0.25)',
      },
      {
        id: 3,
        size: 380,
        initialX: 72,
        initialY: 65,
        duration: 25,
        delay: 2,
        colorGradient: 'radial-gradient(circle at 35% 30%, rgba(255, 255, 255, 0.95), rgba(16, 185, 129, 0.4) 45%, rgba(6, 182, 212, 0.2) 80%, transparent 100%)',
        glowColor: 'rgba(16, 185, 129, 0.22)',
      },
      {
        id: 4,
        size: 190,
        initialX: 18,
        initialY: 75,
        duration: 16,
        delay: 0.5,
        colorGradient: 'radial-gradient(circle at 35% 30%, rgba(255, 255, 255, 0.95), rgba(245, 158, 11, 0.45) 45%, rgba(244, 63, 94, 0.22) 80%, transparent 100%)',
        glowColor: 'rgba(245, 158, 11, 0.25)',
      },
      {
        id: 5,
        size: 280,
        initialX: 45,
        initialY: 35,
        duration: 22,
        delay: 3,
        colorGradient: 'radial-gradient(circle at 35% 30%, rgba(255, 255, 255, 0.95), rgba(99, 102, 241, 0.4) 45%, rgba(147, 197, 253, 0.25) 80%, transparent 100%)',
        glowColor: 'rgba(99, 102, 241, 0.22)',
      },
      {
        id: 6,
        size: 150,
        initialX: 90,
        initialY: 55,
        duration: 15,
        delay: 1.5,
        colorGradient: 'radial-gradient(circle at 35% 30%, rgba(255, 255, 255, 0.95), rgba(236, 72, 153, 0.4) 45%, rgba(244, 114, 182, 0.2) 80%, transparent 100%)',
        glowColor: 'rgba(236, 72, 153, 0.22)',
      },
      {
        id: 7,
        size: 130,
        initialX: 30,
        initialY: 48,
        duration: 14,
        delay: 2.5,
        colorGradient: 'radial-gradient(circle at 35% 30%, rgba(255, 255, 255, 0.95), rgba(20, 184, 166, 0.4) 45%, rgba(56, 189, 248, 0.2) 80%, transparent 100%)',
        glowColor: 'rgba(20, 184, 166, 0.2)',
      },
    ];
    setBubbles(generated);

    const handleMouseMove = (e: MouseEvent) => {
      // Calculate normalized offset from center (-1 to 1)
      const nx = (e.clientX / window.innerWidth - 0.5) * 60;
      const ny = (e.clientY / window.innerHeight - 0.5) * 60;
      mouseX.set(nx);
      mouseY.set(ny);
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [mouseX, mouseY]);

  return (
    <div className="bubble-canvas-container" aria-hidden="true">
      {/* Dynamic Colorful Ambient Lighting Orbs */}
      <motion.div
        style={{
          position: 'absolute',
          top: '-10%',
          left: '15%',
          width: '650px',
          height: '650px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(56, 189, 248, 0.25) 0%, rgba(168, 85, 247, 0.12) 50%, transparent 75%)',
          filter: 'blur(80px)',
          x: springX,
          y: springY,
        }}
      />
      <motion.div
        style={{
          position: 'absolute',
          bottom: '-10%',
          right: '10%',
          width: '600px',
          height: '600px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(244, 63, 94, 0.18) 0%, rgba(245, 158, 11, 0.14) 45%, transparent 75%)',
          filter: 'blur(80px)',
          x: springX,
          y: springY,
        }}
      />

      {/* Interactive Floating Colorful Bubbles */}
      {bubbles.map((b) => (
        <motion.div
          key={b.id}
          className="ambient-bubble"
          style={{
            width: b.size,
            height: b.size,
            left: `${b.initialX}%`,
            top: `${b.initialY}%`,
            background: b.colorGradient,
            boxShadow: `
              inset -12px -12px 28px rgba(255, 255, 255, 0.95),
              inset 12px 12px 32px ${b.glowColor},
              0 20px 40px ${b.glowColor}
            `,
          }}
          animate={{
            y: [0, -40, -85, -30, 0],
            x: [0, 30, -25, 18, 0],
            scale: [1, 1.06, 0.95, 1.04, 1],
            rotate: [0, 10, -8, 6, 0],
          }}
          transition={{
            duration: b.duration,
            repeat: Infinity,
            delay: b.delay,
            ease: 'easeInOut',
          }}
          whileHover={{
            scale: 1.15,
            transition: { duration: 0.3 },
          }}
        />
      ))}
    </div>
  );
};
