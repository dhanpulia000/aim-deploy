# R201~230 구간 병합 누락 문제 분석

## 현재 상태

### 성공한 부분 ✅
- R26~30 구간: 병합 정상 작동 (`isMerged=true`)
- 링크 정보: P열(16열)에 정상적으로 포함됨
- 추적자 로직: `lastWrittenRow`, `contentLastWrittenRow` 구현 완료
- 데이터 정규화: `.toString().trim()` 적용 완료
- 병합 루프 구조: `guaranteedEndRow`까지 실행되도록 보장

### 실패한 부분 ❌
- R201~230 구간: 여전히 병합 누락 (`isMerged=false`)
- 병합 로그: 서버 콘솔에 출력되지만 파일에는 기록되지 않음

## 적용된 수정 사항

### 1. 추적자 강제 동기화 ✅
```javascript
const updateTracker = (rowNum) => {
  lastWrittenRow = Math.max(lastWrittenRow, rowNum);
};
```
- 모든 셀 기입 포인트에서 `updateTracker(currentRow)` 호출
- `setCellValue`, `dMaster.value`, `fMaster.value` 설정 시 모두 추적자 업데이트

### 2. 데이터 정규화 ✅
```javascript
const dValue = String(dCell.value || '').toString().trim();
```
- 모든 값에 `.toString().trim()` 적용하여 보이지 않는 공백 제거

### 3. 물리적 전수 스캔 ✅
```javascript
const actualRowCount = sh.actualRowCount || sh.rowCount || 0;
const scanStartRow = Math.max(actualRowCount, actualLastDataRow + 100, 500);
for (let r = scanStartRow; r >= ingameStartRow; r--) {
  // 역방향으로 실제 데이터가 있는 마지막 행 찾기
}
```

### 4. 병합 루프 경계 조건 보정 ✅
```javascript
const finalMergeEndRow = Math.max(actualLastDataRow + 10, 300);
const guaranteedEndRow = Math.max(finalMergeEndRow, 300);
for (let r = ingameStartRow; r <= guaranteedEndRow; r++) {
  // 병합 적용
}
```

### 5. Row 객체 강제 활성화 ✅
```javascript
const rowObj = sh.getRow(r);
const dCell = rowObj.getCell(4);
const fCell = rowObj.getCell(6);
```

### 6. 명시적 병합 주소 사용 ✅
```javascript
sh.mergeCells(`D${r}:E${r}`);  // 문자열 주소 사용
sh.mergeCells(`F${r}:O${r}`);  // 문자열 주소 사용
```

### 7. 병합 오류 무시 ✅
```javascript
try {
  sh.mergeCells(`D${r}:E${r}`);
} catch (e) {
  // 병합 오류 무시
}
```

### 8. 강제 병합 로그 추가 ✅
```javascript
if (r >= 201 && r <= 230) {
  console.log(`[Merge] Row ${r}: D~E merge attempted, before=${dCellBeforeMerge}, after=${dCellAfterMerge}`);
}
```

## 문제 분석

### 가능한 원인 1: 병합 루프가 실행되지 않음
- `guaranteedEndRow`가 제대로 계산되지 않았을 수 있음
- `actualLastDataRow`가 R201보다 작을 수 있음
- 역방향 스캔에서 데이터를 찾지 못했을 수 있음

### 가능한 원인 2: `hasValue` 조건 불만족
- R201~230 구간의 데이터가 `hasValue` 조건을 만족하지 못할 수 있음
- 데이터 정규화 후에도 빈 문자열로 판단될 수 있음

### 가능한 원인 3: ExcelJS의 `isMerged` 속성 문제
- `isMerged` 속성이 즉시 반영되지 않을 수 있음
- 병합 후에도 `isMerged`가 `false`로 남아있을 수 있음

### 가능한 원인 4: 병합 명령 실행 실패
- `sh.mergeCells()` 호출이 실패했지만 예외가 발생하지 않았을 수 있음
- ExcelJS 내부에서 병합이 무시되었을 수 있음

## 검증 필요 사항

1. **병합 루프 실행 여부 확인**
   - 서버 콘솔에서 `[Merge] Starting merge loop` 로그 확인
   - `guaranteedEndRow` 값 확인

2. **`hasValue` 조건 확인**
   - R201~230 구간의 실제 데이터 값 확인
   - 정규화 후 값이 제대로 추출되는지 확인

3. **병합 명령 실행 확인**
   - `sh.mergeCells()` 호출이 실제로 실행되는지 확인
   - 병합 후 `isMerged` 상태 확인

## 다음 단계 제안

1. **디버깅 강화**: 병합 루프 내부에 더 많은 로그 추가
2. **조건 완화**: `hasValue` 조건을 더 완화하여 모든 행에 병합 시도
3. **대안 접근**: ExcelJS의 병합 API 대신 다른 방법 시도
4. **파일 저장 전 검증**: 파일 저장 전에 병합 상태를 재확인하는 로직 추가
