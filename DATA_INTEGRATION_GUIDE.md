# 실제 데이터 구축 가이드

Agent Ops Wallboard에 실제 데이터를 연동하는 방법을 안내합니다.

## 옵션 1: WebSocket 서버 구축 (추천)

### 1. Node.js 서버 실행

```bash
# WebSocket 서버 의존성 설치
npm install ws express

# 서버 실행
node backend-server.js
```

### 2. 프론트엔드에서 WebSocket 연결

`src/App.tsx` 파일을 수정:

```typescript
useEffect(() => {
  const ws = DataService.connectWebSocket("ws://localhost:8081", (data) => {
    if (data.type === 'initial') {
      setAgents(data.agents);
      setTickets(data.tickets);
    } else if (data.type === 'update') {
      setAgents(data.data.agents);
      setTickets(data.data.tickets);
    }
  });

  return () => {
    ws?.close();
  };
}, []);
```

## 옵션 2: REST API 연동

### 1. API 서버 구축

```javascript
// server.js
const express = require('express');
const app = express();
const PORT = 8080;

app.get('/api/agents', async (req, res) => {
  // 실제 데이터베이스나 서비스에서 데이터 가져오기
  const agents = await getAgentsFromDatabase();
  res.json(agents);
});

app.get('/api/tickets', async (req, res) => {
  const tickets = await getTicketsFromDatabase();
  res.json(tickets);
});

app.listen(PORT, () => {
  console.log(`API 서버 실행: http://localhost:${PORT}`);
});
```

### 2. 프론트엔드에서 API 호출

```typescript
useEffect(() => {
  // 데이터 로드
  const loadData = async () => {
    const agents = await DataService.getAgents();
    const tickets = await DataService.getTickets();
    setAgents(agents);
    setTickets(tickets);
  };
  
  loadData();
  
  // 주기적으로 업데이트
  const interval = setInterval(loadData, 5000);
  return () => clearInterval(interval);
}, []);
```

## 옵션 3: Discord Bot 연동

### 1. Discord Bot 설정

```javascript
// discord-bot.js
const Discord = require('discord.js');
const client = new Discord.Client();

client.on('message', async (message) => {
  if (message.content.startsWith('!issue')) {
    // 이슈 생성 로직
    const ticket = {
      id: generateId(),
      title: message.content,
      source: 'discord',
      createdAt: Date.now(),
      severity: 2,
      sentiment: 'neu',
      status: 'new'
    };
    
    // WebSocket으로 이벤트 전송
    broadcastToWebSocket(ticket);
  }
});

client.login('YOUR_BOT_TOKEN');
```

## 옵션 4: 실제 데이터베이스 연동

### MongoDB 예시

```javascript
const MongoClient = require('mongodb').MongoClient;

async function getAgents() {
  const client = await MongoClient.connect('mongodb://localhost:27017');
  const db = client.db('wallboard');
  const agents = await db.collection('agents').find({}).toArray();
  return agents;
}

async function createTicket(ticket) {
  const client = await MongoClient.connect('mongodb://localhost:27017');
  const db = client.db('wallboard');
  await db.collection('tickets').insertOne(ticket);
}
```

### PostgreSQL 예시

```javascript
const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  database: 'wallboard',
  user: 'postgres',
  password: 'password'
});

async function getAgents() {
  const result = await pool.query('SELECT * FROM agents');
  return result.rows;
}

async function getTickets() {
  const result = await pool.query('SELECT * FROM tickets WHERE status != $1', ['resolved']);
  return result.rows;
}
```

## 옵션 5: 외부 서비스 연동

### Slack Webhook

```javascript
app.post('/slack-webhook', (req, res) => {
  const message = req.body;
  
  const ticket = {
    id: generateId(),
    title: message.text,
    source: 'system',
    createdAt: Date.now(),
    severity: detectSeverity(message.text),
    sentiment: analyzeSentiment(message.text),
    status: 'new'
  };
  
  // WebSocket으로 브로드캐스트
  broadcastToWebSocket(ticket);
  
  res.json({ success: true });
});
```

### Telegram Bot

```javascript
const TelegramBot = require('node-telegram-bot-api');
const bot = new TelegramBot('YOUR_BOT_TOKEN', { polling: true });

bot.onText(/\/issue (.+)/, (msg, match) => {
  const ticket = {
    id: generateId(),
    title: match[1],
ย source: 'telegram',
    createdAt: Date.now(),
    severity: 3,
    sentiment: 'neu',
    status: 'new'
  };
  
  broadcastToWebSocket(ticket);
});
```

## 실시간 업데이트 구현

### Polling 방식

```typescript
useEffect(() => {
  const interval = setInterval(async () => {
    const agents = await DataService.getAgents();
    const tickets = await DataService.getTickets();
    setAgents(agents);
    setTickets(tickets);
  }, 5000); // 5초마다 업데이트

  return () => clearInterval(interval);
}, []);
```

### WebSocket 방식 (권장)

```typescript
useEffect(() => {
  const ws = DataService.connectWebSocket("ws://localhost:8081", (data) => {
    setAgents(dataDto.agents);
    setTickets(data.tickets);
  });

  return () => ws?.close();
}, []);
```

## 보안 고려사항

1. **인증**: JWT 토큰 사용
2. **HTTPS/WSS**: 프로덕션 환경에서 반드시 사용
3. **CORS**: 적절한 CORS 설정
4. **Rate Limiting**: API 요청 제한
5. **데이터 검증**: 입력 데이터 검증

```javascript
// 인증 미들웨어 예시
function authenticate(req, res, next) {
  const token = req.headers.authorization;
  if (!validateToken(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

app.get('/api/agents', authenticate, (req, res) => {
  // ...
});
```

## 배포

### Docker 배포

```dockerfile
FROM node:18

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 8080 8081

CMD ["node", "backend-server.js"]
```

```bash
# 빌드
docker build -t wallboard-backend .

# 실행
docker run -p 8080:8080 -p 8081:8081 wallboard-backend
```

## 모니터링

- **로그**: Winston, Bunyan 등 사용
- **메트릭**: Prometheus, Grafana 연동
- **알람**: 심각한 이슈 발생 시 알림

```javascript
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

logger.info('서버 시작', { timestamp: Date.now() });
```

## 다음 단계

1. 데이터베이스 스키마 설계
2. API 엔드포인트 정의
3. 인증 시스템 구현
4. 로깅 및 모니터링 설정
5. 테스트 작성
6. 배포 및 운영

