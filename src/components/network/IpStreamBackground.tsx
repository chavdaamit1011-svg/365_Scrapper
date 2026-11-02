'use client';

import React, { useEffect, useRef } from 'react';

interface IpPacket {
  ip: string;
  port: string;
  status: string;
  latency: string;
  x: number;
  y: number;
  speed: number;
  opacity: number;
  type: 'v4' | 'v6' | 'cidr';
}

export const IpStreamBackground: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };

    window.addEventListener('resize', handleResize);

    // Realistic IP address pool for scraper telemetry
    const ipPool = [
      '192.168.1.104',
      '104.28.14.92',
      '172.67.180.201',
      '45.33.32.156',
      '185.220.101.5',
      '198.51.100.42',
      '203.0.113.195',
      '142.250.190.46',
      '151.101.1.140',
      '13.107.42.14',
      '24.105.30.129',
      '185.199.108.153',
      '10.0.8.254/24',
      '2606:4700:4700::1111',
      '2001:4860:4860::8888',
      '93.184.216.34',
      '168.119.140.23',
      '51.15.82.120',
      '82.165.197.1',
      '77.88.55.60',
    ];

    const ports = ['443/HTTPS', '80/HTTP', '8080/PROXY', '22/SSH', '9050/SOCKS', '3000/API', '53/DNS'];
    const statuses = ['200 OK', 'CAPTURED', 'INDEXED', 'PROXY-OK', 'SCANNING', 'RESOLVED'];

    // Spawn packets
    const packets: IpPacket[] = [];
    const packetCount = Math.min(32, Math.floor(width / 45));

    for (let i = 0; i < packetCount; i++) {
      packets.push({
        ip: ipPool[Math.floor(Math.random() * ipPool.length)],
        port: ports[Math.floor(Math.random() * ports.length)],
        status: statuses[Math.floor(Math.random() * statuses.length)],
        latency: `${Math.floor(Math.random() * 45 + 4)}ms`,
        x: Math.random() * width,
        y: Math.random() * height,
        speed: 0.35 + Math.random() * 0.65,
        opacity: 0.18 + Math.random() * 0.35,
        type: Math.random() > 0.8 ? 'v6' : 'v4',
      });
    }

    // Grid nodes
    const gridCols = Math.floor(width / 160);
    const gridRows = Math.floor(height / 140);
    const gridPoints: { x: number; y: number; pulse: number }[] = [];

    for (let c = 0; c <= gridCols; c++) {
      for (let r = 0; r <= gridRows; r++) {
        gridPoints.push({
          x: c * 160 + (r % 2 === 0 ? 0 : 30),
          y: r * 140,
          pulse: Math.random() * Math.PI,
        });
      }
    }

    let time = 0;

    const render = () => {
      time += 0.02;
      ctx.clearRect(0, 0, width, height);

      // 1. Draw subtle cyber grid
      ctx.strokeStyle = 'rgba(2, 132, 199, 0.04)';
      ctx.lineWidth = 1;

      for (let x = 0; x < width; x += 80) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }

      for (let y = 0; y < height; y += 80) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // 2. Draw subtle network node points
      for (const pt of gridPoints) {
        pt.pulse += 0.02;
        const radius = 1.5 + Math.sin(pt.pulse) * 0.8;
        const alpha = 0.08 + Math.sin(pt.pulse) * 0.05;

        ctx.fillStyle = `rgba(2, 132, 199, ${alpha})`;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, Math.max(0.5, radius), 0, Math.PI * 2);
        ctx.fill();
      }

      // 3. Draw streaming IP telemetry packets
      for (let i = 0; i < packets.length; i++) {
        const p = packets[i];

        // Move upward like a data telemetry stream
        p.y -= p.speed;

        // Reset when moving off screen
        if (p.y < -40) {
          p.y = height + 30;
          p.x = Math.random() * width;
          p.ip = ipPool[Math.floor(Math.random() * ipPool.length)];
          p.latency = `${Math.floor(Math.random() * 45 + 4)}ms`;
        }

        // Draw node pulse dot
        ctx.fillStyle = `rgba(2, 132, 199, ${p.opacity * 0.9})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
        ctx.fill();

        // Draw connecting tail
        ctx.strokeStyle = `rgba(56, 189, 248, ${p.opacity * 0.25})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x, p.y + 18);
        ctx.stroke();

        // Render IP text in high-tech monospace
        ctx.font = '11px "JetBrains Mono", Consolas, monospace';
        ctx.fillStyle = `rgba(30, 41, 59, ${p.opacity * 0.75})`;
        ctx.fillText(p.ip, p.x + 8, p.y - 2);

        // Subtitle badge: Port + Latency
        ctx.font = '9px "JetBrains Mono", Consolas, monospace';
        ctx.fillStyle = `rgba(2, 132, 199, ${p.opacity * 0.85})`;
        ctx.fillText(`[${p.port} • ${p.latency}]`, p.x + 8, p.y + 11);
      }

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 0,
        overflow: 'hidden',
        background: 'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 60%, #e2e8f0 100%)',
      }}
      aria-hidden="true"
    >
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />

      {/* Cyber radar glow lines */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          width: '100%',
          maxWidth: '1200px',
          height: '1px',
          background: 'linear-gradient(90deg, transparent 0%, rgba(2, 132, 199, 0.3) 50%, transparent 100%)',
        }}
      />
    </div>
  );
};

