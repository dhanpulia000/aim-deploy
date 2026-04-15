#!/bin/bash
# better-sqlite3 빌드에 필요한 도구 설치

echo "=== 빌드 도구 설치 ==="
echo ""

# build-essential 패키지 설치 (make, gcc, g++ 포함)
echo "build-essential 패키지를 설치합니다..."
sudo apt-get update
sudo apt-get install -y build-essential python3

echo ""
echo "✅ 빌드 도구 설치 완료"
echo ""
echo "설치된 도구 버전:"
make --version | head -1
gcc --version | head -1
g++ --version | head -1
python3 --version


