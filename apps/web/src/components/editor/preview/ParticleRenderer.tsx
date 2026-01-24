import React, { useRef, useEffect, useCallback, useMemo } from "react";
import * as THREE from "three";
import {
  getParticleEngine,
  type Particle,
  type ParticleEffect,
} from "@openreel/core";

interface ParticleRendererProps {
  effects: ParticleEffect[];
  width: number;
  height: number;
  currentTime: number;
  isPlaying: boolean;
}

export const ParticleRenderer: React.FC<ParticleRendererProps> = ({
  effects,
  width,
  height,
  currentTime,
  isPlaying,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const geometryRef = useRef<THREE.BufferGeometry | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const currentTimeRef = useRef<number>(currentTime);
  const lastFrameTimeRef = useRef<number>(performance.now());
  const playStartTimeRef = useRef<number>(0);
  const playStartPlayheadRef = useRef<number>(0);
  const isPlayingRef = useRef<boolean>(isPlaying);
  const [isReady, setIsReady] = React.useState(false);

  const engine = useMemo(() => getParticleEngine(), []);

  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  useEffect(() => {
    engine.setCanvasSize(width, height);
  }, [engine, width, height]);

  const prevEffectIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const currentIds = new Set(effects.map(e => e.id));
    const prevIds = prevEffectIdsRef.current;

    for (const effect of effects) {
      const existingEffect = engine.getEffect(effect.id);
      if (!existingEffect) {
        engine.addEffect(effect);
      } else if (!prevIds.has(effect.id)) {
        engine.updateEffect(effect.id, effect.config);
      }
    }

    for (const prevId of prevIds) {
      if (!currentIds.has(prevId)) {
        engine.removeEffect(prevId);
      }
    }

    prevEffectIdsRef.current = currentIds;
  }, [effects, engine]);

  useEffect(() => {
    if (!containerRef.current || width <= 0 || height <= 0) {
      return;
    }

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.OrthographicCamera(
      0,
      width,
      height,
      0,
      0.1,
      1000
    );
    camera.position.z = 100;
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
    });
    renderer.setSize(width, height, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.objectFit = "contain";
    renderer.domElement.style.position = "absolute";
    renderer.domElement.style.top = "0";
    renderer.domElement.style.left = "0";
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(10000 * 3);
    const colors = new Float32Array(10000 * 3);
    const sizes = new Float32Array(10000);
    const alphas = new Float32Array(10000);

    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute("alpha", new THREE.BufferAttribute(alphas, 1));
    geometryRef.current = geometry;

    const material = new THREE.PointsMaterial({
      size: 12,
      vertexColors: true,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: false,
    });

    const points = new THREE.Points(geometry, material);
    scene.add(points);

    setIsReady(true);

    return () => {
      setIsReady(false);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      if (containerRef.current && renderer.domElement) {
        containerRef.current.removeChild(renderer.domElement);
      }
    };
  }, [width, height]);

  const hexToRgbNormalized = useCallback(
    (hex: string): { r: number; g: number; b: number } => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      if (result) {
        return {
          r: parseInt(result[1], 16) / 255,
          g: parseInt(result[2], 16) / 255,
          b: parseInt(result[3], 16) / 255,
        };
      }
      const rgbMatch = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/i.exec(hex);
      if (rgbMatch) {
        return {
          r: parseInt(rgbMatch[1], 10) / 255,
          g: parseInt(rgbMatch[2], 10) / 255,
          b: parseInt(rgbMatch[3], 10) / 255,
        };
      }
      return { r: 1, g: 1, b: 1 };
    },
    []
  );

  const updateParticles = useCallback(
    (particles: Particle[]) => {
      if (!geometryRef.current) return;

      const positions = geometryRef.current.attributes.position.array as Float32Array;
      const colors = geometryRef.current.attributes.color.array as Float32Array;
      const sizes = geometryRef.current.attributes.size.array as Float32Array;

      const count = Math.min(particles.length, 10000);

      for (let i = 0; i < count; i++) {
        const particle = particles[i];
        const i3 = i * 3;

        positions[i3] = particle.position.x;
        positions[i3 + 1] = height - particle.position.y;
        positions[i3 + 2] = particle.position.z;

        const rgb = hexToRgbNormalized(particle.color);
        colors[i3] = rgb.r * particle.opacity;
        colors[i3 + 1] = rgb.g * particle.opacity;
        colors[i3 + 2] = rgb.b * particle.opacity;

        sizes[i] = particle.size;
      }

      for (let i = count; i < 10000; i++) {
        const i3 = i * 3;
        positions[i3] = 0;
        positions[i3 + 1] = 0;
        positions[i3 + 2] = -1000;
        sizes[i] = 0;
      }

      geometryRef.current.attributes.position.needsUpdate = true;
      geometryRef.current.attributes.color.needsUpdate = true;
      geometryRef.current.attributes.size.needsUpdate = true;
      geometryRef.current.setDrawRange(0, count);
    },
    [hexToRgbNormalized, height]
  );

  const render = useCallback(() => {
    if (!rendererRef.current || !sceneRef.current || !cameraRef.current) return;
    rendererRef.current.render(sceneRef.current, cameraRef.current);
  }, []);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    if (!isReady) return;

    if (isPlaying) {
      playStartTimeRef.current = performance.now();
      playStartPlayheadRef.current = currentTimeRef.current;
      lastFrameTimeRef.current = performance.now();

      const animate = () => {
        if (!isPlayingRef.current) return;

        const now = performance.now();
        const deltaMs = now - lastFrameTimeRef.current;
        lastFrameTimeRef.current = now;
        const deltaTime = deltaMs / 1000;

        const elapsedSinceStart = (now - playStartTimeRef.current) / 1000;
        const estimatedCurrentTime = playStartPlayheadRef.current + elapsedSinceStart;

        engine.update(estimatedCurrentTime, deltaTime);
        const particles = engine.getParticles();
        updateParticles(particles);
        render();

        animationFrameRef.current = requestAnimationFrame(animate);
      };

      animationFrameRef.current = requestAnimationFrame(animate);

      return () => {
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
        }
      };
    } else {
      engine.update(currentTime, 1 / 30);
      const particles = engine.getParticles();
      updateParticles(particles);
      render();
    }
  }, [isPlaying, isReady, currentTime, engine, updateParticles, render, effects]);

  useEffect(() => {
    if (cameraRef.current) {
      cameraRef.current.left = 0;
      cameraRef.current.right = width;
      cameraRef.current.top = height;
      cameraRef.current.bottom = 0;
      cameraRef.current.updateProjectionMatrix();
    }
    if (rendererRef.current) {
      rendererRef.current.setSize(width, height, false);
    }
  }, [width, height]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 pointer-events-none w-full h-full"
      style={{ zIndex: 50 }}
    />
  );
};

export default ParticleRenderer;
