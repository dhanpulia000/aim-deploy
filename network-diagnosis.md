# 네트워크 접속 문제 진단

## 서버 상태 ✅
- 호스트명: ib-monitor
- 내부 IP: 10.1.186.30
- 공인 IP: 61.74.194.125
- 포트: 8080 (리스닝 중, 0.0.0.0 바인딩)
- 서버에서 curl 접속: 모두 성공

## 질문

### 1. 브라우저를 어디서 실행하고 계신가요?
- a) 서버와 같은 컴퓨터 (ib-monitor)
- b) 같은 네트워크의 다른 컴퓨터
- c) 완전히 다른 네트워크 (집, 카페 등)

### 2. 브라우저에서 어떤 주소로 접속하셨나요?
- localhost:8080
- 10.1.186.30:8080
- 61.74.194.125:8080
- 다른 주소

### 3. 브라우저에 표시되는 에러 메시지는?
- "이 페이지에 연결할 수 없습니다"
- "ERR_CONNECTION_TIMED_OUT"
- "ERR_CONNECTION_REFUSED"
- 다른 메시지

## 시나리오별 해결 방법

### 시나리오 A: 같은 컴퓨터 (ib-monitor)
**접속 주소:** http://localhost:8080
**추가 조치:** 없음 (서버에서 curl 성공하므로 브라우저 문제)
**확인:** 브라우저 캐시 삭제, 다른 브라우저 시도

### 시나리오 B: 같은 네트워크의 다른 컴퓨터
**접속 주소:** http://10.1.186.30:8080
**문제:** 서버 방화벽 (UFW) 차단
**해결:**
```bash
sudo ufw allow 8080/tcp
sudo ufw reload
```

### 시나리오 C: 다른 네트워크 (인터넷)
**접속 주소:** http://61.74.194.125:8080
**문제:** 
1. 서버 방화벽 (UFW)
2. 클라우드 Security Group
3. 라우터 포트 포워딩

**해결:**
```bash
# 1. 서버 방화벽
sudo ufw allow 8080/tcp
sudo ufw reload

# 2. 클라우드 콘솔에서 Security Group 설정
#    AWS: EC2 > Security Groups > Inbound Rules > Add 8080/TCP
#    Azure: VM > Networking > Add Inbound Port Rule > 8080
#    GCP: VPC > Firewall Rules > Create Rule > 8080/TCP

# 3. 라우터 설정 (사설 네트워크인 경우)
#    공인 IP:8080 → 내부 IP:8080 포트 포워딩
```

## 현재 서버에서 확인된 정보

```
호스트: ib-monitor
내부 IP: 10.1.186.30/16
게이트웨이: 10.1.30.253
공인 IP: 61.74.194.125

서버 상태: 실행 중
포트 8080: 0.0.0.0 바인딩 (모든 인터페이스)
UFW 방화벽: 활성화됨 (비활성화 테스트 완료)
```

## 테스트 명령

### 브라우저가 있는 컴퓨터에서 실행
```bash
# Windows (PowerShell)
Test-NetConnection -ComputerName 10.1.186.30 -Port 8080

# Linux/Mac
nc -zv 10.1.186.30 8080
curl http://10.1.186.30:8080

# 또는 브라우저 개발자 도구 (F12) > Console에서
fetch('http://10.1.186.30:8080/')
  .then(r => console.log('Success:', r.status))
  .catch(e => console.error('Error:', e))
```

