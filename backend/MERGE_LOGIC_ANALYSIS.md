# PC 주간 보고서 병합 로직 분석 및 문제점 정리

## 현재 병합 로직 구조

### 1. 초기 설정 단계
- **ingameStartRow**: 26 (인게임 동향 섹션 시작 행)
- **contentStartRow**: 69 (컨텐츠 동향 섹션 시작 행)
- **preservedRows**: 섹션 헤더 및 컬럼 헤더 행 집합 (병합 대상에서 제외)
- **currentRow**: 현재 데이터를 채우는 행 위치 (초기값: DATA_START_ROW = 26)

### 2. 인게임 동향 섹션 채우기 (R26~R68)
```javascript
// 1단계: 데이터 채우기와 동시에 병합 시도
ingameVoc.forEach(v => {
  // D~E 병합 시도
  if (!dCell.isMerged) {
    sh.mergeCells(currentRow, 4, currentRow, 5);
  }
  // F~O 병합 시도
  if (!fCell.isMerged) {
    sh.mergeCells(currentRow, 6, currentRow, 15);
  }
  currentRow++;
});

// 2단계: 채운 행들에 대해 병합 구조 재확인
const ingameEndRow = currentRow;
for (let r = ingameStartRow; r < ingameEndRow; r++) {
  // D~E, F~O 병합 재확인 및 적용
}
```

**문제점**:
- 데이터 채우기 중 병합 시도는 있지만, 실제로 병합이 실패할 수 있음
- `ingameEndRow`는 `currentRow`를 그대로 사용하므로, 실제 데이터가 있는 마지막 행과 다를 수 있음

### 3. 컨텐츠 동향 섹션 채우기 (R69~)
```javascript
// 1단계: 데이터 채우기와 동시에 병합 시도
currentRow = contentStartRow; // 69로 재설정
contentVoc.forEach(v => {
  // D~E, F~O 병합 시도
  currentRow++;
});

// 2단계: 채운 행들에 대해 병합 구조 재확인
const contentEndRow = currentRow;
for (let r = contentStartRow; r < contentEndRow; r++) {
  // D~E, F~O 병합 재확인 및 적용
}
```

**문제점**:
- `contentEndRow`는 `currentRow`를 그대로 사용하므로, 실제 데이터가 있는 마지막 행과 다를 수 있음
- R201~230 구간이 `contentEndRow` 범위를 벗어날 수 있음

### 4. 최종 안전장치 (전체 스캔)
```javascript
// 역방향으로 실제 데이터가 있는 마지막 행 찾기
let actualLastDataRow = contentEndRow - 1;
const searchMaxRow = Math.max(contentEndRow, clearEndRow, sh.rowCount || 0, 500);

for (let r = searchMaxRow; r >= ingameStartRow; r--) {
  if (hasValue) {
    actualLastDataRow = r;
    break;
  }
}

// 최종 병합 적용
const extendedEndRow = Math.max(contentEndRow + 50, 300);
const finalMaxRow = Math.max(actualLastDataRow + 50, extendedEndRow, clearEndRow, 500);

for (let r = ingameStartRow; r <= finalMaxRow; r++) {
  // D~E, F~O 병합 적용
}
```

**문제점**:
- `searchMaxRow`가 너무 크면 (예: 500, 1098) 역방향 스캔이 비효율적이고, 실제 데이터가 있는 행을 찾지 못할 수 있음
- `actualLastDataRow`가 `contentEndRow - 1`로 초기화되어 있어, 실제 데이터가 있는 마지막 행보다 작을 수 있음
- `finalMaxRow` 계산이 복잡하고, 실제 데이터 범위를 정확히 반영하지 못할 수 있음

## 발생하는 문제들

### 문제 1: R201~230 구간 병합 누락
**증상**: R201~230 구간의 데이터 행들이 `isMerged=false` 상태로 남아있음

**원인 분석**:
1. `contentEndRow`가 실제 데이터가 있는 마지막 행보다 작을 수 있음
   - 예: `contentEndRow = 200`인데 실제 데이터는 R230까지 있음
2. 역방향 스캔이 제대로 작동하지 않을 수 있음
   - `searchMaxRow`가 너무 크면 (예: 1098) 역방향 스캔이 비효율적
   - `preservedRows`에 포함된 행을 건너뛰면서 실제 데이터 행을 놓칠 수 있음
3. `finalMaxRow` 계산이 실제 데이터 범위를 정확히 반영하지 못함
   - `actualLastDataRow`가 잘못 계산되면 `finalMaxRow`도 잘못됨

### 문제 2: 병합 로직 중복 실행
**증상**: 같은 행에 대해 병합을 여러 번 시도함

**원인 분석**:
1. 데이터 채우기 중 병합 시도 (1차)
2. 섹션별 병합 재확인 (2차)
3. 최종 안전장치 전체 스캔 (3차)

**영향**: 성능 저하, 불필요한 연산

### 문제 3: 링크 정보는 정상 작동
**증상**: P열(16열)에 링크 정보가 정상적으로 포함됨

**원인 분석**: 링크 정보는 데이터 채우기 중에 직접 설정되므로 문제 없음

## 해결 방안 제안

### 방안 1: 실제 데이터가 있는 마지막 행 정확히 찾기
```javascript
// 역방향 스캔 범위를 실제 데이터 범위로 제한
const searchStartRow = Math.min(contentEndRow + 100, sh.rowCount || 0, 300);
const searchEndRow = Math.max(contentEndRow, clearEndRow);

// 역방향으로 실제 데이터가 있는 마지막 행 찾기
let actualLastDataRow = contentEndRow - 1;
for (let r = searchStartRow; r >= searchEndRow; r--) {
  if (preservedRows.has(r)) continue;
  const row = sh.getRow(r);
  const hasValue = norm(row.getCell(2).value) || norm(row.getCell(3).value) || 
                  norm(row.getCell(4).value) || norm(row.getCell(6).value);
  if (hasValue) {
    actualLastDataRow = r;
    break;
  }
}
```

### 방안 2: 병합 로직 단순화
```javascript
// 데이터 채우기 중 병합 시도 제거, 최종 단계에서만 병합 적용
// 또는 데이터 채우기 중 병합만 유지하고 중복 제거
```

### 방안 3: 병합 범위 명확히 설정
```javascript
// 실제 데이터가 있는 마지막 행을 정확히 찾은 후, 넉넉한 여유를 두고 병합 적용
const finalMaxRow = Math.max(actualLastDataRow + 20, contentEndRow + 20, 300);
```

## 테스트 결과

### 성공한 부분
- ✅ R26~30 구간: 병합 정상 작동 (`isMerged=true`)
- ✅ 링크 정보: P열에 정상적으로 포함됨

### 실패한 부분
- ❌ R201~230 구간: 병합 누락 (`isMerged=false`)
- ❌ 병합 로직 중복 실행으로 인한 성능 저하 가능성

## 다음 단계

1. 역방향 스캔 로직 개선
2. 병합 범위 계산 정확도 향상
3. 불필요한 병합 시도 제거
4. 실제 데이터가 있는 마지막 행 정확히 찾기
