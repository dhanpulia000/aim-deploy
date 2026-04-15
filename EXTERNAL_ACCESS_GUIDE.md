# 외부 접속 설정 가이드

## 진단 결과

### 네트워크 상황
- **브라우저 PC IP:** 192.168.4.56 (다른 네트워크)
- **서버 내부 IP:** 10.1.186.30 (다른 네트워크)
- **서버 공인 IP:** 61.74.194.125
- **문제:** 두 네트워크가 분리되어 있어 내부 IP로 접속 불가

### 해결책
공인 IP를 사용해야 합니다: `http://61.74.194.125:8080`

## 클라우드 Security Group 설정

### AWS EC2
1. EC2 콘솔 → Instances → 해당 인스턴스 선택
2. Security 탭 → Security Groups 클릭
3. Inbound rules → Edit inbound rules
4. Add rule:
   - Type: Custom TCP
   - Port range: 8080
   - Source: 0.0.0.0/0 (모든 IP) 또는 특정 IP (192.168.4.56/32)
   - Description: Agent Ops Wallboard
5. Save rules

### Azure VM
1. Virtual machines → 해당 VM 선택
2. Networking → Add inbound port rule
3. 설정:
   - Destination port ranges: 8080
   - Protocol: TCP
   - Action: Allow
   - Priority: 100
   - Name: Allow-8080
4. Add

### GCP Compute Engine
1. VPC network → Firewall
2. Create firewall rule:
   - Name: allow-wallboard
   - Targets: All instances in the network
   - Source IP ranges: 0.0.0.0/0
   - Protocols and ports: tcp:8080
3. Create

### 일반 서버 (온프레미스)
1. 라우터 관리 페이지 접속
2. Port Forwarding 설정:
   - External Port: 8080
   - Internal IP: 10.1.186.30
   - Internal Port: 8080
   - Protocol: TCP
3. 저장 및 적용

## 방화벽 설정 (서버)

```bash
# UFW 규칙 추가
sudo ufw allow 8080/tcp comment "Agent Ops Wallboard"
sudo ufw reload
sudo ufw status numbered
```

## 테스트

### Windows PowerShell (브라우저 PC에서)
```powershell
# 공인 IP로 연결 테스트
Test-NetConnection -ComputerName 61.74.194.125 -Port 8080

# 또는
curl http://61.74.194.125:8080
```

### 브라우저 접속
```
http://61.74.194.125:8080
```

로그인 정보:
- 이메일: admin@example.com
- 비밀번호: admin123

## 보안 권장사항

1. **특정 IP만 허용** (더 안전):
   - Source: 192.168.4.56/32 (브라우저 PC IP만)

2. **HTTPS 사용** (프로덕션):
   - Let's Encrypt로 SSL 인증서 설정
   - Nginx 리버스 프록시 사용

3. **VPN 사용**:
   - 서버 네트워크에 VPN으로 연결
   - 그 후 내부 IP (10.1.186.30:8080) 사용

