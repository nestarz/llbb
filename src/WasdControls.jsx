import { useEffect, useRef, useState, useLayoutEffect } from "react";
import { useThree } from "@react-three/fiber";
import { Vector3 } from "three";
import { useSteps } from "./App";

export const useCodes = () => {
  const codes = useRef(new Set());
  useEffect(() => {
    const onKeyDown = (e) => codes.current.add(e.code);
    const onKeyUp = (e) => codes.current.delete(e.code);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);
  return codes;
};

export const useWasdJump = (fn) => {
  useLayoutEffect(() => {
    const jump = ({ code }) => code === "Space" && fn();
    window.addEventListener("keydown", jump);
    return () => window.removeEventListener("keydown", jump);
  }, [fn]);
};

const upVector = Object.freeze(new Vector3(0, 1, 0));

export const useWasdMove = ({ playerSpeed = 20 } = {}) => {
  const { controls } = useThree();
  const codes = useCodes();

  return (delta) => {
    const { x, y, z } = {
      x: codes.current.has("KeyA") ? -1 : codes.current.has("KeyD") ? 1 : 0,
      z: codes.current.has("KeyW") ? -1 : codes.current.has("KeyS") ? 1 : 0,
      y: 0,
    };
    const angle = controls.getAzimuthalAngle();
    const dir = new Vector3();
    const distance = playerSpeed * delta;
    dir.set(x, y, z).applyAxisAngle(upVector, angle);
    return [dir, distance];
  };
};

export const useWasdControls = (refProp) => {
  const { controls } = useThree();
  const refInner = useRef();
  const ref = refProp ?? refInner;
  const move = useWasdMove();
  useSteps((_, delta) => {
    if (!controls) return;
    const [dir, dist] = move(delta);
    ref.current.position.addScaledVector(dir, dist);
    ref.current.updateMatrixWorld();
  });
  return ref;
};

export default () => {
  const { camera } = useThree();
  useWasdControls({ current: camera });
  return null;
};
