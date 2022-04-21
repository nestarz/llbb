import { Point, Points } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useState } from "react";
import { useRef } from "react";
import { useLayoutEffect } from "react";
import { useMemo } from "react";
import * as THREE from "three";
import { MathUtils } from "three";

const randomOnUnitSphere = (N) => {
  const vectors = new Float32Array(N * 3);

  for (let i = 0; i < N; i += 3) {
    let x, y, z, norm;
    while (true) {
      x = 0.5 - Math.random();
      y = 0.5 - Math.random();
      z = 0.5 - Math.random();
      norm = (x ** 2 + y ** 2 + z ** 2) ** 0.5;
      if (norm < 1) break;
    }
    vectors[i + 0] = x / norm;
    vectors[i + 1] = y / norm;
    vectors[i + 2] = z / norm;
  }
  return vectors;
};

export const Fireworks = ({ color = "pink", size = 0.5 }) => {
  const duration = useMemo(() => Math.floor(1 + Math.random() * 3), []);
  const K = 0.1; // distance coeff
  const A = 3; // acceleration coeff
  const N = 10000;
  const verticesRef = useRef(new Float32Array(N * 3));
  const dir = useMemo(() => randomOnUnitSphere(N), []);
  const acc = useMemo(() => randomOnUnitSphere(N), []);
  const pointsRef = useRef();
  const elapsed = useRef(Math.random() * duration);

  const reset = () => {
    elapsed.current = 0;
    verticesRef.current = new Float32Array(N * 3);
    pointsRef.current.position.setX((0.5 - Math.random()) * 500);
    pointsRef.current.position.setZ((0.5 - Math.random()) * 500);
    pointsRef.current.position.setY(20 + Math.random() * 20);
  };
  useLayoutEffect(reset, []);

  useFrame((_, delta) => {
    elapsed.current += delta;
    const points = pointsRef.current;
    const vertices = verticesRef.current;

    const abs = Math.abs;
    const el = elapsed.current;
    for (let i = 0; i < N; i += 3) {
      vertices[i + 0] += (dir[i + 0] + acc[i + 0] * A) * K;
      vertices[i + 1] +=
        (dir[i + 1] + acc[i + 1] * A - abs((dir[i + 1] * el) / 2)) * K;
      vertices[i + 2] += (dir[i + 2] + acc[i + 2] * A) * K;
    }
    const gpositions = new THREE.Float32BufferAttribute(vertices, 3);
    points.geometry.setAttribute("position", gpositions);
    points.material.opacity = 1 - el / duration;

    if (elapsed.current > duration) reset();
  });

  return (
    <points ref={pointsRef} castShadow>
      <bufferGeometry />
      <pointsMaterial size={size} color={color} transparent />
    </points>
  );
};
