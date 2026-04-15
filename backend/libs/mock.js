// 공유 Mock 데이터 (WebSocket 및 레거시 API용)

let agents = [
  { id: "a1", name: "Jin", status: "busy", handling: 2, todayResolved: 8, avgHandleSec: 320, channelFocus: ["PUBG PC"] },
  { id: "a2", name: "Ara", status: "available", handling: 0, todayResolved: 5, avgHandleSec: 410, channelFocus: ["PUBG MOBILE", "PUBG NEW STATE"] },
  { id: "a3", name: "Min", status: "away", handling: 0, todayResolved: 3, avgHandleSec: 520, channelFocus: ["PUBG MOBILE"] },
  { id: "a4", name: "Hyeon", status: "busy", handling: 1, todayResolved: 10, avgHandleSec: 290, channelFocus: ["PUBG PC", "PUBG ESPORTS"] }
];

let tickets = [
  { id: "t101", title: "[버그] 결제 실패 보고 증상", source: "discord", createdAt: Date.now()-1000*60*7, slaDeadlineAt: Date.now()+1000*60*8, severity: 1, sentiment: "neg", status: "triage", tags: ["결제","버그"], link: "#" },
  { id: "t102", title: "불편함 - 주말 서버", source: "naver", createdAt: Date.now()-1000*60*20, slaDeadlineAt: Date.now()+1000*60*30, severity: 2, sentiment: "neg", status: "new", tags: ["서버"], link: "#" },
  { id: "t103", title: "신규 업데이트 가이드 좋네요", source: "discord", createdAt: Date.now()-1000*60*2, severity: 3, sentiment: "pos", status: "new", link: "#" },
  { id: "t104", title: "카페 이벤트 참여 공지 문의", source: "naver", createdAt: Date.now()-1000*60*90, severity: 3, sentiment: "neu", status: "in_progress", assigneeId: "a2", link: "#" }
];

function addTicket(ticket) {
  tickets.push(ticket);
}

module.exports = {
  agents,
  tickets,
  addTicket
};


