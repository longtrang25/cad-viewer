FROM python:3.11-slim

# Install system dependencies for ODA File Converter
RUN apt-get update && apt-get install -y \
    wget \
    gdebi-core \
    libxcb-util1 \
    xvfb \
    libxkbcommon-x11-0 \
    libxkbcommon0 \
    libgl1 \
    libegl1 \
    libfontconfig1 \
    libdbus-1-3 \
    libxcb-cursor0 \
    libxcb-icccm4 \
    libxcb-image0 \
    libxcb-keysyms1 \
    libxcb-randr0 \
    libxcb-render-util0 \
    libxcb-shape0 \
    libxcb-xfixes0 \
    && rm -rf /var/lib/apt/lists/*

# Fix library symlink issue
RUN ln -s /usr/lib/x86_64-linux-gnu/libxcb-util.so.1 /usr/lib/x86_64-linux-gnu/libxcb-util.so.0 || true

# Download and install ODA File Converter
RUN wget -c "https://www.opendesign.com/guestfiles/get?filename=ODAFileConverter_QT6_lnxX64_8.3dll_27.1.deb" -O ODAFileConverter.deb \
    && gdebi -n ODAFileConverter.deb \
    && rm ODAFileConverter.deb

# Create symlink for standard path used in python
RUN ln -s /usr/bin/oda-file-converter /usr/bin/ODAFileConverter || true

WORKDIR /app

# Copy requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code
COPY . .

EXPOSE 8000

# Start server
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
