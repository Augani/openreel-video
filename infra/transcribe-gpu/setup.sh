#!/bin/bash
set -e

echo "=== OpenReel GPU Transcription Setup ==="

if ! command -v nvidia-smi &> /dev/null; then
    echo "ERROR: NVIDIA drivers not found. Use a Deep Learning AMI."
    exit 1
fi

echo "GPU detected:"
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader

if ! command -v docker &> /dev/null; then
    echo "Installing Docker..."
    curl -fsSL https://get.docker.com | sh
    sudo usermod -aG docker $USER
    echo "Docker installed. You may need to log out and back in for group changes."
fi

if ! dpkg -l | grep -q nvidia-container-toolkit; then
    echo "Installing NVIDIA Container Toolkit..."
    curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | \
        sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
    curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
        sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
        sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
    sudo apt-get update
    sudo apt-get install -y nvidia-container-toolkit
    sudo nvidia-ctk runtime configure --runtime=docker
    sudo systemctl restart docker
fi

echo "Building and starting transcription service..."
docker compose up -d --build

echo ""
echo "Waiting for service to start (model download may take a few minutes)..."
for i in $(seq 1 60); do
    if curl -s http://localhost:8000/health | grep -q '"ready":true'; then
        echo ""
        echo "=== Service is ready! ==="
        curl -s http://localhost:8000/health | python3 -m json.tool
        exit 0
    fi
    printf "."
    sleep 10
done

echo ""
echo "Service not ready yet. Check logs with: docker compose logs -f"
