'use client';

import React, { useEffect, useState, useRef } from 'react';
import { motion, useMotionValue, useSpring } from 'framer-motion';

interface Point {
  x: number;
  y: number;
}

export const VenomCursor: React.FC = () => {
  const [isVisible, setIsVisible] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [isTouchDevice, setIsTouchDevice] = useState(false);

  // Mouse coordinates
  const mouseX = useMotionValue(-100);
  const mouseY = useMotionValue(-100);

  // Smooth venom spring physics
  const springConfig = { damping: 22, stiffness: 280, mass: 0.6 };
  const smoothX = useSpring(mouseX, springConfig);
  const smoothY = useSpring(mouseY, springConfig);

  // Secondary delayed springs for the venom symbiote tail
  const tailSpringConfig = { damping: 18, stiffness: 180, mass: 0.9 };
  const tailX = useSpring(mouseX, tailSpringConfig);
  const tailY = useSpring(mouseY, tailSpringConfig);

  const trail3Spring = { damping: 14, stiffness: 120, mass: 1.2 };
  const trail3X = useSpring(mouseX, trail3Spring);
  const trail3Y = useSpring(mouseY, trail3Spring);

  useEffect(() => {
    // Detect touch device
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
      setIsTouchDevice(true);
      return;
    }

    const handleMouseMove = (e: MouseEvent) => {
      mouseX.set(e.clientX);
      mouseY.set(e.clientY);
      if (!isVisible) setIsVisible(true);
    };

    const handleMouseLeave = () => {
      setIsVisible(false);
    };

    const handleMouseEnter = () => {
      setIsVisible(true);
    };

    // Detect hover over interactive elements
    const handleElementHover = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      const interactive = target.closest('button, input, a, select, textarea, [role="button"], .clickable');
      setIsHovering(!!interactive);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mousemove', handleElementHover);
    document.addEventListener('mouseleave', handleMouseLeave);
    document.addEventListener('mouseenter', handleMouseEnter);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mousemove', handleElementHover);
      document.removeEventListener('mouseleave', handleMouseLeave);
      document.removeEventListener('mouseenter', handleMouseEnter);
    };
  }, [isVisible, mouseX, mouseY]);

  if (isTouchDevice || !isVisible) {
    return null;
  }

  return (
    <div className="venom-cursor-trail" aria-hidden="true">
      {/* SVG filter for gooey/metaball venom symbiote effect */}
      <svg style={{ position: 'absolute', width: 0, height: 0 }}>
        <defs>
          <filter id="venom-goo">
            <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -9"
              result="goo"
            />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>
        </defs>
      </svg>

      <div style={{ filter: 'url(#venom-goo)', pointerEvents: 'none' }}>
        {/* Venom Tendril Droplet 3 (Deepest tail) */}
        <motion.div
          style={{
            position: 'fixed',
            left: trail3X,
            top: trail3Y,
            width: isHovering ? 20 : 12,
            height: isHovering ? 20 : 12,
            borderRadius: '50%',
            background: 'radial-gradient(circle, #0284c7 0%, #0369a1 80%)',
            transform: 'translate(-50%, -50%)',
            opacity: 0.5,
            pointerEvents: 'none',
          }}
        />

        {/* Venom Tendril Droplet 2 (Middle body) */}
        <motion.div
          style={{
            position: 'fixed',
            left: tailX,
            top: tailY,
            width: isHovering ? 32 : 18,
            height: isHovering ? 32 : 18,
            borderRadius: '50%',
            background: 'radial-gradient(circle, #0ea5e9 0%, #0284c7 70%, #0f172a 100%)',
            transform: 'translate(-50%, -50%)',
            opacity: 0.75,
            pointerEvents: 'none',
          }}
        />

        {/* Venom Head (Primary fluid cursor) */}
        <motion.div
          style={{
            position: 'fixed',
            left: smoothX,
            top: smoothY,
            width: isHovering ? 46 : 24,
            height: isHovering ? 46 : 24,
            borderRadius: '50%',
            background: isHovering
              ? 'radial-gradient(circle, #38bdf8 0%, #0284c7 60%, #090d16 100%)'
              : 'radial-gradient(circle, #0284c7 0%, #0369a1 70%, #090d16 100%)',
            transform: 'translate(-50%, -50%)',
            boxShadow: isHovering
              ? '0 0 20px rgba(56, 189, 248, 0.8), 0 0 35px rgba(2, 132, 199, 0.5)'
              : '0 0 12px rgba(2, 132, 199, 0.7)',
            pointerEvents: 'none',
            transition: 'width 0.2s cubic-bezier(0.16, 1, 0.3, 1), height 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        />
      </div>
    </div>
  );
};

