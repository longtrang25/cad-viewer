import os
import tempfile
import subprocess
import shutil
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.background import BackgroundTask

app = FastAPI()

# Cấu hình CORS để cho phép frontend gọi tới
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

def cleanup_dirs(dirs: list):
    """Xóa các thư mục tạm sau khi xử lý xong"""
    for d in dirs:
        try:
            if os.path.exists(d):
                shutil.rmtree(d, ignore_errors=True)
        except Exception as e:
            print(f"Error cleaning up dir {d}: {e}")

@app.post("/api/convert-dwg")
async def convert_dwg_to_dxf(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".dwg"):
        raise HTTPException(status_code=400, detail="Chỉ hỗ trợ định dạng DWG.")
    
    # ODA File Converter path (Windows & Linux)
    oda_path = None
    if os.name == 'nt':
        oda_base = r"C:\Program Files\ODA"
        if os.path.exists(oda_base):
            for root, dirs, files in os.walk(oda_base):
                if "ODAFileConverter.exe" in files:
                    oda_path = os.path.join(root, "ODAFileConverter.exe")
                    break
    else:
        oda_path = "/usr/bin/ODAFileConverter"
                
    if not oda_path or not os.path.exists(oda_path):
        return JSONResponse(
            status_code=500,
            content={"detail": "Không tìm thấy ODA File Converter. Vui lòng cài đặt phần mềm tại: https://www.opendesign.com/guestfiles/oda_file_converter"}
        )

    # Tạo thư mục input và output riêng cho ODA
    temp_in = tempfile.mkdtemp()
    temp_out = tempfile.mkdtemp()
    
    input_path = os.path.join(temp_in, "input.dwg")
    dxf_filename = file.filename.lower().replace(".dwg", ".dxf")
    output_path = os.path.join(temp_out, "input.dxf")
    
    try:
        # 1. Lưu file DWG
        with open(input_path, "wb") as buffer:
            content = await file.read()
            buffer.write(content)
            
        # 2. Gọi ODA File Converter
        print(f"Đang chạy ODA File Converter cho file {file.filename}...")
        
        env = os.environ.copy()
        env["QT_DEBUG_PLUGINS"] = "1"
        
        if os.name == 'nt':
            command = [oda_path, temp_in, temp_out, "ACAD2018", "DXF", "0", "1"]
            process = subprocess.run(command, capture_output=True, text=True, env=env)
        else:
            command = ["xvfb-run", "-a", oda_path, temp_in, temp_out, "ACAD2018", "DXF", "0", "1"]
            process = subprocess.run(command, capture_output=True, text=True, env=env)
        
        if not os.path.exists(output_path):
            cleanup_dirs([temp_in, temp_out])
            raise HTTPException(status_code=500, detail=f"Chuyển đổi thất bại (Code {process.returncode}). Stderr: {process.stderr} | Stdout: {process.stdout}")
        
        # 3. Trả file về cho client
        task = BackgroundTask(cleanup_dirs, [temp_in, temp_out])
        return FileResponse(output_path, media_type="application/dxf", filename=dxf_filename, background=task)
        
    except Exception as e:
        cleanup_dirs([temp_in, temp_out])
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=f"Lỗi hệ thống khi chuyển đổi: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
