import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  Html,
  OrbitControls,
  Plane,
  RoundedBox,
  Segment,
  Segments,
  Stars,
  Text,
  useAspect,
  useBVH,
  useHelper,
  useProgress,
  useTexture,
} from "@react-three/drei";
import Dungeon, { useStore } from "./Dungeon.jsx";
import { useWasdJump, useWasdMove } from "./WasdControls.jsx";
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { MeshBVHVisualizer } from "three-mesh-bvh";
import { Suspense, useRef, useMemo, useState, useLayoutEffect } from "react";
import {
  BackSide,
  Box3,
  BoxGeometry,
  CameraHelper,
  DirectionalLightHelper,
  DoubleSide,
  Line3,
  Matrix4,
  RepeatWrapping,
  Vector3,
} from "three";
import { Object3D, PCFSoftShadowMap, sRGBEncoding } from "three";
import { BMWalker } from "./utils/BMwalker.js";
import { useEffect } from "react";
import { Fireworks } from "./Fireworks.jsx";
import Webcam from "react-webcam";

const Loader = () => {
  const { progress } = useProgress();
  return <Html center>{progress} % loaded</Html>;
};

const Platform = () => {
  return <Dungeon />;
};

const bakeGeometry = (c) => {
  return c.geometry.clone().applyMatrix4(c.matrixWorld);
};

const useCollider = ({
  splitStrategy = "CENTER",
  visualizeDepth = 20,
  debug = false,
} = {}) => {
  const mesh = useMemo(() => ({ current: new Object3D() }), []);
  const nodes = useStore((state) => state.nodes);

  const geometry = useMemo(() => {
    const geometries = Object.values(nodes)
      .filter(({ geometry: v }) => v)
      .map(bakeGeometry);

    return geometries.length > 0
      ? BufferGeometryUtils.mergeBufferGeometries(geometries, false)
      : new BoxGeometry(1, 1, 1);
  }, [nodes]);

  useLayoutEffect(() => void (mesh.current.geometry = geometry), [geometry]);
  useBVH(mesh, { splitStrategy });
  useHelper(mesh, debug ? MeshBVHVisualizer : null, { visualizeDepth });

  const getDeltaVector = (player, radius, segment) => {
    const tempVector = new Vector3();
    const tempVector2 = new Vector3();
    const tempBox = new Box3();
    const tempMat = new Matrix4();
    const tempSegment = new Line3();

    tempBox.makeEmpty();
    tempMat.copy(mesh.current.matrixWorld).invert();
    tempSegment.copy(segment);

    // get the position of the capsule in the local space of the collider
    tempSegment.start.applyMatrix4(player.matrixWorld).applyMatrix4(tempMat);
    tempSegment.end.applyMatrix4(player.matrixWorld).applyMatrix4(tempMat);

    // get the axis aligned bounding box of the capsule
    tempBox.expandByPoint(tempSegment.start);
    tempBox.expandByPoint(tempSegment.end);

    tempBox.min.addScalar(-radius);
    tempBox.max.addScalar(radius);

    mesh.current.geometry.boundsTree?.shapecast({
      intersectsBounds: (box) => box.intersectsBox(tempBox),
      intersectsTriangle: (tri) => {
        // check if the triangle is intersecting the capsule and adjust the
        // capsule position if it is.
        const triPoint = tempVector;
        const capsulePoint = tempVector2;

        const distance = tri.closestPointToSegment(
          tempSegment,
          triPoint,
          capsulePoint
        );
        if (distance < radius) {
          const depth = radius - distance;
          const direction = capsulePoint.sub(triPoint).normalize();

          tempSegment.start.addScaledVector(direction, depth);
          tempSegment.end.addScaledVector(direction, depth);
        }
      },
    });

    const newPosition = tempVector;
    newPosition.copy(tempSegment.start).applyMatrix4(mesh.current.matrixWorld);

    const deltaVector = new Vector3();
    deltaVector.subVectors(newPosition, player.position);
    return deltaVector;
  };

  return { mesh, geometry, getDeltaVector };
};

const useCollidePlayer = (
  ref,
  {
    segment,
    reset: reset_,
    gravity = -30,
    wasd = true,
    angle = 90,
    velocity: vProp,
  } = {}
) => {
  const getDeltaVector = useStore((state) => state.getDeltaVector);
  const [velocity] = useState(() => vProp ?? new Vector3());
  const onGround = useRef(false);
  const reset = () => (reset_(), velocity.set(0, 0, 0));
  const move = useWasdMove();
  wasd && useWasdJump(() => onGround.current && (velocity.y = 20.0));
  useSteps((_, delta) => {
    velocity.y += onGround.current ? 0 : delta * gravity;
    ref.current.position.addScaledVector(velocity, delta);
    if (ref.current.position.y < -150) reset();

    if (wasd) {
      const [dir, distance] = move(delta);
      ref.current.position.addScaledVector(dir, distance);
      ref.current.updateMatrixWorld();
    } else {
      const upVector = Object.freeze(new Vector3(0, 1, 0));
      const dir = new Vector3();
      const distance = 0.005;
      dir.set(1, 0, 0).applyAxisAngle(upVector, angle);
      ref.current.position.addScaledVector(dir, distance);
      ref.current.updateMatrixWorld();
    }

    const deltaVector = getDeltaVector(ref.current, 0.5, segment);
    onGround.current = deltaVector.y > Math.abs(delta * velocity.y * 0.25);
    const offset = Math.max(0.0, deltaVector.length() - 1e-5);
    deltaVector.normalize().multiplyScalar(offset);
    // adjust the player model
    ref.current.position.add(deltaVector);
    if (!onGround.current) {
      deltaVector.normalize();
      velocity.addScaledVector(deltaVector, -deltaVector.dot(velocity));
    } else velocity.set(0, 0, 0);
  });
};

const usePlayer = ({ pos }) => {
  const { camera, controls } = useThree();
  const ref = useRef();
  const [segment] = useState(
    () => new Line3(new Vector3(), new Vector3(0, -1.0, 0.0))
  );
  const follow = () => {
    if (!controls) return;
    camera.position.sub(controls.target);
    controls.target.copy(ref.current.position);
    camera.position.add(ref.current.position);
  };
  const reset = () => void ref.current.position.set(...pos);
  useCollidePlayer(ref, { segment, reset, wasd: true });
  useLayoutEffect(reset, []);
  useLayoutEffect(follow, [controls]);
  useFrame(follow);

  return ref;
};

const Player = ({ video, light }) => {
  const ref = usePlayer({ pos: [15.75, -3, 30] });
  const videoRef = useRef();
  useLayoutEffect(() => void ref.current.geometry.translate(0, -0.5, 0), []);
  useFrame(() => {
    if (!light) return;
    light.current.target = ref.current;
    ref.current.getWorldPosition(videoRef.current.position);
    videoRef.current.position.add(new Vector3(0, 2.5, 0));
  });

  return (
    <group>
      <mesh ref={videoRef} scale={[16, 9, 1]} rotation={[Math.PI / 2, 0, 0]}>
        <planeBufferGeometry />
        <meshBasicMaterial toneMapped={false} side={DoubleSide}>
          <videoTexture attach="map" args={[video]} encoding={sRGBEncoding} />
        </meshBasicMaterial>
      </mesh>
      <RoundedBox
        ref={ref}
        args={[1, 2, 1]}
        radius={0.5}
        smoothness={10}
        castShadow
        receiveShadow
      >
        <meshBasicMaterial color="#fff" shadowSide={2} />
      </RoundedBox>
    </group>
  );
};

const fns = new Map();
const getId = ((i) => (() => i++))(0); // prettier-ignore
export const useSteps = (fn, { steps = 5 } = {}) => {
  useFrame((p1, delta) => {
    for (let i = 0; i < steps; i++) {
      fn(p1, delta / steps);
    }
  });
};

const bmw = new BMWalker();

const Walker = ({ walkerHeight = 10, angle, d, texture } = {}) => {
  const spheres = useRef({});
  const group = useRef();

  const [letter] = useMemo(
    () =>
      "Joyeux Anniversaire Louise!"
        .split("")
        .reverse()
        .map((d, i) => [d, i])[-1] ?? "",
    []
  );
  const pos = useMemo(
    () =>
      letter
        ? [0, 30, 0]
        : [350 / 2 - Math.random() * 350, 30, 350 / 2 - Math.random() * 350],
    []
  );
  const markers = useMemo(() => bmw.getLineMarkers(walkerHeight), [bmw]);

  useFrame(() => {
    const markers = bmw.getLineMarkers(walkerHeight);
    markers.map(([{ x: x1, y: y1, i: desc }, { x: x2, y: y2 }]) => {
      spheres.current[desc].start.set(x1, -y1 + 2, 0);
      spheres.current[desc].end.set(x2, -y2 + 2, 0);
    });
  });

  const [segment] = useState(
    () => new Line3(new Vector3(), new Vector3(0, 1.0, 0.0))
  );
  const reset = () => void group.current.position.set(...pos);
  const [velocity] = useState(() => new Vector3());
  useCollidePlayer(group, { segment, reset, wasd: false, angle, velocity });

  const addSnapshots = useStore((state) => state.addSnapshots);
  useEffect(() => {
    const id = setInterval(
      () =>
        addSnapshots(
          Object.values(spheres.current).map(({ start, end }) => [
            start.clone().add(group.current.position),
            end.clone().add(group.current.position),
          ])
        ),
      1000 + 200 * d
    );
    return () => clearInterval(id);
  }, []);

  return (
    <group ref={group} position={pos} onClick={() => (velocity.y = -1000)}>
      {letter ? (
        <Text
          color="white"
          anchorX="center"
          anchorY="middle"
          position={[0, 11.25, 0]}
          fontSize={12}
        >
          {letter}
        </Text>
      ) : (
        texture && (
          <Plane
            args={[192 / 2, 100 / 2, 108 / 2]}
            position={[0, 11.5, 0]}
            rotation={[Math.PI / 2, 0, 0]}
          >
            <meshBasicMaterial
              side={DoubleSide}
              map={texture}
            ></meshBasicMaterial>
          </Plane>
        )
      )}
      <Segments limit={markers.length} lineWidth={0.5}>
        {markers.map(([{ x: x1, y: y1, i: desc }, { x: x2, y: y2 }], i) => (
          <Segment
            key={i}
            start={[x1, -y1, x1 / y1]}
            end={[x2, -y2, x2 / y2]}
            color="#fff"
            ref={(elt) => (spheres.current[desc] = elt)}
          />
        ))}
      </Segments>
    </group>
  );
};

const Snapshots = () => {
  const snapshots = useStore((state) => state.snapshots);

  return (
    <Segments
      limit={snapshots.map((d) => d.length).reduce((a, b) => a + b, 0)}
      lineWidth={0.5}
    >
      {snapshots.map((markers) =>
        markers.map(([{ x: x1, y: y1, z: z1 }, { x: x2, y: y2, z: z2 }], i) => (
          <Segment
            key={i}
            start={[x1, y1, z1]}
            end={[x2, y2, z2]}
            color="white"
          />
        ))
      )}
    </Segments>
  );
};

const images = Object.keys(import.meta.glob("../public/*.jpg")).map((d) =>
  d.replace("../public/", "/")
);

const Video = ({ video }) => {
  useEffect(() => void video.play(), [video]);
  return (
    <mesh
      position={[0, 0, 0]}
      rotation={[0, Math.PI / 2, 0]}
      scale={[1600, 900, 100]}
    >
      <sphereBufferGeometry />
      <meshBasicMaterial toneMapped={false} side={BackSide}>
        <videoTexture
          attach="map"
          args={[video]}
          encoding={sRGBEncoding}
          repeat={[20, 20]}
          wrapS={RepeatWrapping}
          wrapT={RepeatWrapping}
        />
      </meshBasicMaterial>
    </mesh>
  );
};

const Game = ({ debug, bgColor, webcam } = {}) => {
  const { controls, camera } = useThree();
  const { mesh, geometry, getDeltaVector } = useCollider();

  const setGetDeltaVector = useStore((state) => state.setGetDeltaVector);
  useLayoutEffect(() => {
    setGetDeltaVector(getDeltaVector);
  }, [getDeltaVector]);

  const light1 = useRef();
  useHelper(debug && light1, DirectionalLightHelper, "cyan");
  const cameraLight1 = useRef();
  useHelper(debug && cameraLight1, CameraHelper, "cyan");

  useLayoutEffect(() => {
    camera.position.set(0, -10, -500);
    camera.far = 1000;
  }, []);

  useFrame(() => {
    if (!controls) return;
    controls.minDistance = 1;
    controls.maxDistance = 2000;
  });

  const textures = useTexture(images.filter((v) => v.includes("shox.")));

  return (
    <Suspense fallback={<Loader />}>
      {webcam && <Video video={webcam} />}
      <Stars
        radius={1}
        depth={500}
        count={10000}
        factor={10}
        saturation={0}
        fade
        speed={1}
      />
      <Snapshots />
      {[...Array(120).keys()].map((d) => (
        <Walker
          key={d}
          angle={(d / 100) * Math.PI * 2}
          d={d}
          texture={d < 1 && textures[d % textures.length]}
        />
      ))}
      <fog attach="fog" args={["hsl(220, 100%, 5%)", 20, 70]} far={1000} />
      <color attach="background" args={[bgColor]} />
      <Fireworks />
      <Fireworks />
      <directionalLight
        ref={light1}
        color={0xffffff}
        intensity={1}
        position={[1, 1.5, 1].map((d) => d * 50)}
        shadow-mapSize={[2048, 2048].map((d) => d * 2)}
        shadow-bias={-1e-4}
        shadow-normalBias={0.05}
        castShadow
      >
        <orthographicCamera
          attach="shadow-camera"
          args={[-30, 45, 30, -30]}
          ref={cameraLight1}
        />
      </directionalLight>
      <hemisphereLight
        groundColor={0x223344}
        intensity={0.4}
        skyColor={0xffffff}
      />
      <OrbitControls makeDefault />
      <Platform />
      {debug && (
        <mesh ref={mesh} geometry={geometry}>
          <meshStandardMaterial wireframe opacity={0.1} transparent />
        </mesh>
      )}
      <Player light={light1} video={webcam} />
      <ambientLight intensity={0.25} />
    </Suspense>
  );
};

export default ({ bgColor = "#FFF" }) => {
  const webcam = useRef();
  const [video, setVideo] = useState();
  useLayoutEffect(() => {
    Object.entries({
      position: "absolute",
      top: 0,
      visibility: "hidden",
      pointerEvents: "none",
    }).map(([k, v]) => (webcam.current.video.style[k] = v));
    setVideo(webcam.current.video);
  }, []);
  return (
    <>
      <Canvas
        shadows
        onCreated={({ gl: renderer }) => {
          renderer.setPixelRatio(window.devicePixelRatio);
          renderer.setSize(window.innerWidth, window.innerHeight);
          renderer.setClearColor(bgColor, 1);
          renderer.shadowMap.enabled = true;
          renderer.shadowMap.type = PCFSoftShadowMap;
          renderer.outputEncoding = sRGBEncoding;
        }}
      >
        <Game bgColor={bgColor} webcam={video} />
      </Canvas>
      <Webcam ref={webcam} />
    </>
  );
};
