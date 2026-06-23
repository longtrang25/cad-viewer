import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { DxfViewer } from 'dxf-viewer';
import type { LayerInfo } from 'dxf-viewer';
import * as THREE from 'three';

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
        await viewer.Load({ 
          url: fileUrl,
          fonts: ["/fonts/arial.ttf"]
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
        if (scene && onLayerSelected) {
          raycaster.params.Line.threshold = (camera.top - camera.bottom) * 0.02;
          raycaster.params.Points.threshold = (camera.top - camera.bottom) * 0.02;
          const intersects = raycaster.intersectObjects(scene.children, true);
          if (intersects.length > 0) {
            let obj: any = intersects[0].object;
            while (obj && !obj._dxfViewerLayer) {
              obj = obj.parent;
            }
            if (obj && obj._dxfViewerLayer) {
              onLayerSelected(obj._dxfViewerLayer.name);
            }
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
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm z-30">
          <div className="flex flex-col items-center">
            <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
            <p className="text-slate-300 font-medium animate-pulse">Đang xử lý dữ liệu CAD...</p>
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
