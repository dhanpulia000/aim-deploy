# 빠른 설정 가이드 - Snap Docker

## 현재 상황
- ✅ Docker가 설치되어 있습니다 (Snap)
- ⚠️  docker 그룹 설정이 필요합니다

## 설정 방법

터미널에서 다음 명령어를 순서대로 실행하세요:

### 1단계: docker 그룹 생성 및 사용자 추가
```bash
sudo groupadd docker
sudo usermod -aG docker $USER
```

### 2단계: 새 그룹 활성화
```bash
newgrp docker
```

**주의**: `newgrp docker` 명령어를 실행하면 새 쉘 세션이 시작됩니다.
테스트 후 `exit`로 원래 쉘로 돌아올 수 있습니다.

### 3단계: Docker 접근 테스트
```bash
docker ps
```

성공하면 (오류 없이 빈 목록 또는 컨테이너 목록이 나오면) 다음 단계로 진행하세요.

## 자동 설정 스크립트 실행

Docker 접근이 정상이면:

```bash
cd /home/young-dev/AIM/backend
bash scripts/auto-setup-vector-search.sh
```

이 스크립트가 자동으로:
- ✅ PostgreSQL + pgvector 컨테이너 생성 및 실행
- ✅ pgvector 확장 설치
- ✅ .env 파일 업데이트
- ✅ 테이블 초기화

## 문제 해결

### "permission denied" 오류
- `newgrp docker` 명령어를 실행했는지 확인
- 로그아웃 후 다시 로그인
- `groups` 명령어로 docker 그룹이 표시되는지 확인

### "docker group does not exist" 오류
- `sudo groupadd docker` 명령어 실행

### 여전히 접근 불가
- `sudo docker ps`로 테스트 (sudo로는 작동하는지 확인)
- Docker 서비스 상태 확인: `sudo systemctl status snap.docker.dockerd`
