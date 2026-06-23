import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { DxfViewer } from 'dxf-viewer';
import type { LayerInfo } from 'dxf-viewer';
import * as THREE from 'three';
import DxfWorker from '../workers/dxf.worker?worker';

export interface CADViewerRef {
  getLayers: () => LayerInfo[];
  toggleLayer: (name: string, show: boolean) => void;
  clearMarkup: () => void;
}

interface CADViewerProps {
  fileUrl: string;
  activeTool: 'pan' | 'measure' | 'markup' | 'select_layer';
  markupColor?: string;
  onLayersLoaded: (layers: LayerInfo[]) => void;
  onMeasureResult?: (distance: number, pt1: THREE.Vector3, pt2: THREE.Vector3) => void;
  onLayerSelected?: (layerName: string) => void;
}

const CADViewer = forwardRef<CADViewerRef, CADViewerProps>(({ fileUrl, activeTool, markupColor = '#ef4444', onLayersLoaded, onMeasureResult, onLayerSelected }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerInstance = useRef<DxfViewer | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingPhase, setLoadingPhase] = useState<string>('');
  const [loadingProgress, setLoadingProgress] = useState<number>(0);
  const measurePoints = useRef<THREE.Vector3[]>([]);
  const [measureScreenPoints, setMeasureScreenPoints] = useState<{x: number, y: number}[]>([]);
  
  // Markup state
  const markupCanvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);

  useImperativeHandle(ref, () => ({
    getLayers: () => {
      if (!viewerInstance.current) return [];
      return Array.from(viewerInstance.current.GetLayers());
    },
    toggleLayer: (name: string, show: boolean) => {
      viewerInstance.current?.ShowLayer(name, show);
      viewerInstance.current?.Render();
    },
    clearMarkup: () => {
      const ctx = markupCanvasRef.current?.getContext('2d');
      if (ctx && markupCanvasRef.current) {
        ctx.clearRect(0, 0, markupCanvasRef.current.width, markupCanvasRef.current.height);
      }
    }
  }));

  // Initialize Viewer
  useEffect(() => {
    if (!containerRef.current) return;

    const viewer = new DxfViewer(containerRef.current, {
      autoResize: true,
      clearColor: new THREE.Color('#0f172a'), // Tailwind slate-900
    });
    viewerInstance.current = viewer;

    const loadFile = async () => {
      try {
        setLoading(true);
        setLoadingPhase('Khởi tạo...');
        setLoadingProgress(0);

        await viewer.Load({ 
          url: fileUrl,
          fonts: ["/fonts/arial.ttf"],
          workerFactory: () => new DxfWorker(),
          progressCbk: (phase: string, processedSize: number, totalSize: number) => {
             let phaseText = '';
             switch(phase) {
               case 'fetch': phaseText = 'Đang tải tệp CAD...'; break;
               case 'parse': phaseText = 'Đang giải mã dữ liệu...'; break;
               case 'prepare': phaseText = 'Đang dựng hình 3D...'; break;
               case 'font': phaseText = 'Đang tải phông chữ...'; break;
               default: phaseText = 'Đang xử lý...';
             }
             setLoadingPhase(phaseText);
             if (totalSize > 0) {
                 setLoadingProgress(Math.round((processedSize / totalSize) * 100));
             } else {
                 setLoadingProgress((prev) => Math.min(prev + 5, 95));
             }
          }
        });
        onLayersLoaded(Array.from(viewer.GetLayers()));
        setLoading(false);
      } catch (error) {
        console.error('Lỗi khi load file DXF:', error);
        alert('Lỗi khi load file DXF: ' + (error as Error).message);
        setLoading(false);
      }
    };

    loadFile();

    return () => {
      viewer.Destroy();
    };
  }, [fileUrl, onLayersLoaded]);

  // Handle measurement logic
  useEffect(() => {
    if (activeTool !== 'measure') {
      setMeasureScreenPoints([]);
      measurePoints.current = [];
    }
    
    const canvas = viewerInstance.current?.GetCanvas();
    if (!canvas) return;

    const handlePointerDown = (e: PointerEvent) => {
      if (activeTool !== 'measure' && activeTool !== 'select_layer') return;
      e.stopPropagation();

      const viewer = viewerInstance.current;
      if (!viewer) return;

      const rect = canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      const camera = viewer.GetCamera();
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(x, y), camera);

      if (activeTool === 'select_layer') {
        const scene = viewer.GetScene();
        const renderer = viewer.GetRenderer();
        if (scene && renderer && onLayerSelected) {
          const originalMaterials = new Map<any, any>();
          const colorToLayer = new Map<number, string>();
          let nextColorId = 1;

          scene.traverse((obj: any) => {
            if (obj.material && obj._dxfViewerLayer) {
              originalMaterials.set(obj, obj.material);
              const layerName = obj._dxfViewerLayer.name;
              
              let hex = 0;
              for (const [existingHex, name] of colorToLayer.entries()) {
                 if (name === layerName) {
                     hex = existingHex;
                     break;
                 }
              }
              if (hex === 0) {
                 const i = nextColorId++;
                 const r = (i % 10) * 25;
                 const g = (Math.floor(i / 10) % 10) * 25;
                 const b = (Math.floor(i / 100) % 10) * 25 + 50;
                 hex = (r << 16) | (g << 8) | b;
                 colorToLayer.set(hex, layerName);
              }

              const newMat = obj.material.clone();
              if (newMat.uniforms && newMat.uniforms.color) {
                 const exactColor = new THREE.Color();
                 exactColor.r = ((hex >> 16) & 0xff) / 255.0;
                 exactColor.g = ((hex >> 8) & 0xff) / 255.0;
                 exactColor.b = (hex & 0xff) / 255.0;
                 newMat.uniforms.color.value = exactColor;
              }
              obj.material = newMat;
            }
          });

          // Disable clear color
          const oldClearColor = new THREE.Color();
          renderer.getClearColor(oldClearColor);
          const oldClearAlpha = renderer.getClearAlpha();
          renderer.setClearColor(0x000000, 0);

          // Render target
          const rt = new THREE.WebGLRenderTarget(canvas.width, canvas.height, {
              format: THREE.RGBAFormat,
              type: THREE.UnsignedByteType,
              minFilter: THREE.NearestFilter,
              magFilter: THREE.NearestFilter,
              generateMipmaps: false,
          });

          renderer.setRenderTarget(rt);
          renderer.clear();
          renderer.render(scene, camera);

          // Read pixel area
          const scaleX = canvas.width / rect.width;
          const scaleY = canvas.height / rect.height;
          const clientX = (e.clientX - rect.left) * scaleX;
          const clientY = (e.clientY - rect.top) * scaleY;
          const glX = Math.floor(clientX);
          const glY = Math.floor(canvas.height - clientY);

          const readSize = 9; // 9x9 area to make thin lines easier to click
          let startX = glX - Math.floor(readSize/2);
          let startY = glY - Math.floor(readSize/2);
          let width = readSize;
          let height = readSize;

          if (startX < 0) { width += startX; startX = 0; }
          if (startY < 0) { height += startY; startY = 0; }
          if (startX + width > canvas.width) { width = canvas.width - startX; }
          if (startY + height > canvas.height) { height = canvas.height - startY; }

          let pickedLayer = "";

          if (width > 0 && height > 0) {
            const readBuffer = new Uint8Array(width * height * 4);
            renderer.readRenderTargetPixels(rt, startX, startY, width, height, readBuffer);

            for (let i = 0; i < width * height; i++) {
               const pr = readBuffer[i*4];
               const pg = readBuffer[i*4 + 1];
               const pb = readBuffer[i*4 + 2];
               const pa = readBuffer[i*4 + 3];
               if (pa > 0 && (pr > 0 || pg > 0 || pb > 0)) {
                   let bestDist = Infinity;
                   let bestLayer = "";
                   for (const [lHex, name] of colorToLayer.entries()) {
                       const lr = (lHex >> 16) & 0xff;
                       const lg = (lHex >> 8) & 0xff;
                       const lb = lHex & 0xff;
                       const dist = Math.abs(pr - lr) + Math.abs(pg - lg) + Math.abs(pb - lb);
                       if (dist < bestDist) {
                           bestDist = dist;
                           bestLayer = name;
                       }
                   }
                   if (bestDist < 20) {
                       pickedLayer = bestLayer;
                       break;
                   }
               }
            }
          }

          // Restore
          renderer.setRenderTarget(null);
          renderer.setClearColor(oldClearColor, oldClearAlpha);
          rt.dispose();

          scene.traverse((obj: any) => {
            if (originalMaterials.has(obj)) {
              obj.material.dispose();
              obj.material = originalMaterials.get(obj);
            }
          });
          viewer.Render();

          if (pickedLayer) {
             onLayerSelected(pickedLayer);
          }
        }
        return;
      }

      const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
      const target = new THREE.Vector3();
      raycaster.ray.intersectPlane(plane, target);

      if (target) {
        const clientX = e.clientX - rect.left;
        const clientY = e.clientY - rect.top;

        setMeasureScreenPoints(prev => {
          if (prev.length >= 2) {
             measurePoints.current = [target];
             return [{x: clientX, y: clientY}];
          }
          measurePoints.current.push(target);
          return [...prev, {x: clientX, y: clientY}];
        });

        if (measurePoints.current.length === 2) {
          const pt1 = measurePoints.current[0];
          const pt2 = measurePoints.current[1];
          const distance = pt1.distanceTo(pt2);
          if (onMeasureResult) {
            onMeasureResult(distance, pt1, pt2);
          }
        }
      }
    };

    if (activeTool === 'measure' || activeTool === 'select_layer') {
      canvas.addEventListener('pointerdown', handlePointerDown, { capture: true });
    }

    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown, { capture: true });
    };
  }, [activeTool, onMeasureResult]);

  // Markup Logic (Freehand Drawing)
  useEffect(() => {
    const canvas = markupCanvasRef.current;
    if (!canvas) return;
    
    // Resize canvas to match container
    const resizeCanvas = () => {
      if (containerRef.current) {
        canvas.width = containerRef.current.clientWidth;
        canvas.height = containerRef.current.clientHeight;
      }
    };
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    return () => window.removeEventListener('resize', resizeCanvas);
  }, [activeTool]);

  const startDrawing = (e: React.PointerEvent<HTMLCanvasElement>) => {
    isDrawing.current = true;
    const ctx = markupCanvasRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.beginPath();
    ctx.moveTo(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
  };

  const draw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing.current) return;
    const ctx = markupCanvasRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.strokeStyle = markupColor; // Dynamic markup color
    ctx.lineTo(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
    ctx.stroke();
  };

  const stopDrawing = () => {
    isDrawing.current = false;
    const ctx = markupCanvasRef.current?.getContext('2d');
    if (ctx) ctx.closePath();
  };

  return (
    <div className="relative w-full h-full overflow-hidden">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900/80 backdrop-blur-sm z-30">
          <div className="flex flex-col items-center bg-slate-800 p-8 rounded-2xl shadow-2xl border border-slate-700 w-80">
            <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-6"></div>
            <p className="text-blue-400 font-bold text-lg mb-2 text-center">{loadingPhase || 'Đang xử lý dữ liệu CAD...'}</p>
            
            {/* Progress Bar */}
            <div className="w-full bg-slate-700 rounded-full h-2.5 mb-2 overflow-hidden shadow-inner">
              <div 
                className="bg-gradient-to-r from-blue-500 to-cyan-400 h-2.5 rounded-full transition-all duration-300 ease-out" 
                style={{ width: `${loadingProgress}%` }}
              ></div>
            </div>
            <p className="text-slate-400 text-sm font-medium">{loadingProgress}% hoàn thành</p>
          </div>
        </div>
      )}
      
      {/* 3D CAD Viewer Canvas Container */}
      <div 
        ref={containerRef} 
        className={`w-full h-full outline-none z-10 ${
          activeTool === 'pan' ? 'cursor-grab active:cursor-grabbing' : 
          activeTool === 'measure' ? 'cursor-crosshair' : 'cursor-default'
        }`}
        style={{ touchAction: 'none' }}
      />

      {/* Measurement Overlay */}
      {activeTool === 'measure' && measureScreenPoints.length > 0 && (
        <svg className="absolute inset-0 w-full h-full pointer-events-none z-20">
          {measureScreenPoints.map((pt, i) => (
             <circle key={i} cx={pt.x} cy={pt.y} r="5" fill="#3b82f6" stroke="#fff" strokeWidth="2" />
          ))}
          {measureScreenPoints.length === 2 && (
             <line 
                x1={measureScreenPoints[0].x} y1={measureScreenPoints[0].y}
                x2={measureScreenPoints[1].x} y2={measureScreenPoints[1].y}
                stroke="#3b82f6" strokeWidth="3" strokeDasharray="5,5" 
             />
          )}
        </svg>
      )}

      {/* Markup 2D Canvas Overlay */}
      {activeTool === 'markup' && (
        <canvas
          ref={markupCanvasRef}
          className="absolute inset-0 z-20 cursor-crosshair touch-none"
          onPointerDown={startDrawing}
          onPointerMove={draw}
          onPointerUp={stopDrawing}
          onPointerOut={stopDrawing}
        />
      )}
    </div>
  );
});

export default CADViewer;
