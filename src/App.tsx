import React, { useState, useRef, useCallback } from 'react';
import CADViewer from './components/CADViewer';
import type { CADViewerRef } from './components/CADViewer';
import { Upload, Layers, Ruler, Edit3, Settings, Info, Eye, EyeOff, Trash2 } from 'lucide-react';
import type { LayerInfo } from 'dxf-viewer';

function App() {
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [layersOpen, setLayersOpen] = useState(false);
  const [activeTool, setActiveTool] = useState<'pan' | 'measure' | 'markup'>('pan');
  const [layers, setLayers] = useState<LayerInfo[]>([]);
  const [hiddenLayers, setHiddenLayers] = useState<Set<string>>(new Set());
  const [measureResult, setMeasureResult] = useState<number | null>(null);
  const [isConverting, setIsConverting] = useState(false);

  const viewerRef = useRef<CADViewerRef>(null);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.name.toLowerCase().endsWith('.dwg')) {
        try {
          setIsConverting(true);
          const formData = new FormData();
          formData.append('file', file);
          
          const response = await fetch(import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api/convert-dwg` : '/api/convert-dwg', {
            method: 'POST',
            body: formData,
          });
          
          if (!response.ok) {
            let errorMsg = 'Lỗi xử lý file DWG';
            try {
              const err = await response.json();
              errorMsg = err.detail || errorMsg;
            } catch (e) {}
            throw new Error(errorMsg);
          }
          
          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          setFileUrl(url);
        } catch (e: any) {
          alert('Chuyển đổi thất bại: ' + e.message);
        } finally {
          setIsConverting(false);
        }
      } else {
        const url = URL.createObjectURL(file);
        setFileUrl(url);
      }
      
      setLayers([]);
      setHiddenLayers(new Set());
      setMeasureResult(null);
    }
  };

  const handleLayersLoaded = useCallback((loadedLayers: LayerInfo[]) => {
    setLayers(loadedLayers);
  }, []);

  const handleMeasureResult = useCallback((distance: number) => {
    setMeasureResult(distance);
    // Tự động chuyển về công cụ Pan sau khi đo xong để tránh click nhầm
    setActiveTool('pan');
  }, []);

  const toggleLayer = (name: string) => {
    const newHidden = new Set(hiddenLayers);
    let show = false;
    if (newHidden.has(name)) {
      newHidden.delete(name);
      show = true;
    } else {
      newHidden.add(name);
    }
    setHiddenLayers(newHidden);
    viewerRef.current?.toggleLayer(name, show);
  };

  return (
    <div className="w-screen h-screen flex flex-col bg-slate-900 text-slate-100 overflow-hidden relative">
      {/* Top Bar */}
      <header className="h-14 bg-slate-800/80 backdrop-blur-md flex items-center justify-between px-4 border-b border-slate-700 z-10 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center font-bold">
            V
          </div>
          <h1 className="font-semibold text-lg tracking-tight">CAD Viewer</h1>
        </div>
        
        {fileUrl && (
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setLayersOpen(!layersOpen)}
              className={`p-2 rounded-lg transition-colors ${layersOpen ? 'bg-blue-600 text-white' : 'bg-slate-700 hover:bg-slate-600'}`}
            >
              <Layers size={20} />
            </button>
            <button className="p-2 rounded-lg bg-slate-700 hover:bg-slate-600 transition-colors">
              <Settings size={20} />
            </button>
          </div>
        )}
      </header>

      {/* Main Content Area */}
      <main className="flex-1 relative w-full h-full">
        {!fileUrl ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
            <div className="w-24 h-24 mb-6 rounded-full bg-slate-800 flex items-center justify-center shadow-lg border border-slate-700">
              <Upload size={40} className="text-blue-500" />
            </div>
            <h2 className="text-2xl font-bold mb-2">Mở bản vẽ CAD</h2>
            <p className="text-slate-400 mb-8 max-w-sm">
              Hỗ trợ định dạng DXF và DWG. File DWG sẽ được chuyển đổi tự động qua máy chủ nội bộ.
            </p>
            {isConverting ? (
              <div className="px-6 py-3 bg-slate-700 text-white rounded-xl font-medium shadow-lg flex items-center gap-3">
                <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
                Đang chuyển đổi DWG...
              </div>
            ) : (
              <label className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-medium cursor-pointer shadow-lg shadow-blue-500/20 transition-all active:scale-95">
                Chọn File Bản Vẽ (DXF, DWG)
                <input type="file" accept=".dxf,.dwg" className="hidden" onChange={handleFileUpload} />
              </label>
            )}
          </div>
        ) : (
          <CADViewer 
            ref={viewerRef}
            fileUrl={fileUrl} 
            activeTool={activeTool} 
            onLayersLoaded={handleLayersLoaded}
            onMeasureResult={handleMeasureResult}
          />
        )}

        {/* Measure Result Banner */}
        {measureResult !== null && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-blue-900/90 border border-blue-500 text-blue-100 px-6 py-3 rounded-full shadow-2xl backdrop-blur-md z-50 flex items-center gap-3 animate-in fade-in slide-in-from-top-4">
            <Ruler size={18} className="text-blue-400" />
            <span className="font-semibold">Khoảng cách: {measureResult.toFixed(2)} đơn vị</span>
            <button 
              onClick={() => setMeasureResult(null)}
              className="ml-2 text-blue-300 hover:text-white"
            >
              ✕
            </button>
          </div>
        )}

        {/* Floating Tool Bar */}
        {fileUrl && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 p-2 bg-slate-800/90 backdrop-blur-md border border-slate-700 rounded-2xl shadow-2xl z-50">
            <ToolButton 
              active={activeTool === 'pan'} 
              onClick={() => { setActiveTool('pan'); setMeasureResult(null); }} 
              icon={<Info size={22} />} 
              label="Pan (Vuốt)"
            />
            <div className="w-px h-8 bg-slate-700 mx-1"></div>
            <ToolButton 
              active={activeTool === 'measure'} 
              onClick={() => { setActiveTool('measure'); setMeasureResult(null); }} 
              icon={<Ruler size={22} />} 
              label="Đo đạc (Chọn 2 điểm)"
            />
            <ToolButton 
              active={activeTool === 'markup'} 
              onClick={() => { setActiveTool('markup'); setMeasureResult(null); }} 
              icon={<Edit3 size={22} />} 
              label="Ghi chú"
            />
            {activeTool === 'markup' && (
              <>
                <div className="w-px h-8 bg-slate-700 mx-1"></div>
                <button 
                  onClick={() => viewerRef.current?.clearMarkup()}
                  className="p-3 rounded-xl flex flex-col items-center justify-center gap-1 transition-all text-red-400 hover:text-red-300 hover:bg-slate-700/50"
                  title="Xóa ghi chú"
                >
                  <Trash2 size={22} />
                </button>
              </>
            )}
          </div>
        )}

        {/* Layer Panel Overlay */}
        {layersOpen && (
          <div className="absolute top-0 right-0 bottom-0 w-80 bg-slate-800/95 backdrop-blur-xl border-l border-slate-700 z-20 shadow-2xl p-4 flex flex-col transform transition-transform animate-in slide-in-from-right">
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <Layers size={18} className="text-blue-400" /> Quản lý Layer
              </h3>
              <button onClick={() => setLayersOpen(false)} className="p-2 rounded-lg bg-slate-700 hover:bg-slate-600 transition-colors">
                ✕
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto space-y-2 pr-2">
              {layers.length === 0 ? (
                <p className="text-sm text-slate-400 italic">Không tìm thấy layer nào.</p>
              ) : (
                layers.map(layer => {
                  const isHidden = hiddenLayers.has(layer.name);
                  // Màu layer là số RGB dạng 0xRRGGBB, convert sang CSS hex:
                  const colorHex = '#' + layer.color.toString(16).padStart(6, '0');
                  
                  return (
                    <div 
                      key={layer.name}
                      className="flex items-center justify-between p-3 rounded-xl bg-slate-700/30 hover:bg-slate-700/50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div 
                          className="w-4 h-4 rounded-full border border-slate-600" 
                          style={{ backgroundColor: colorHex }}
                        />
                        <span className={`text-sm truncate w-40 ${isHidden ? 'text-slate-500 line-through' : 'text-slate-200'}`}>
                          {layer.displayName || layer.name}
                        </span>
                      </div>
                      <button 
                        onClick={() => toggleLayer(layer.name)}
                        className={`p-1.5 rounded-lg transition-colors ${isHidden ? 'text-slate-500 hover:bg-slate-600' : 'text-blue-400 hover:bg-slate-600'}`}
                      >
                        {isHidden ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function ToolButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button
      onClick={onClick}
      className={`p-3 rounded-xl flex flex-col items-center justify-center gap-1 transition-all ${
        active ? 'bg-blue-600 text-white shadow-inner scale-105' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
      }`}
      title={label}
    >
      {icon}
    </button>
  );
}

export default App;
