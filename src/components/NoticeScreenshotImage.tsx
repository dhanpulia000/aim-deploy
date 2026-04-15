import { useState } from "react";

interface NoticeScreenshotImageProps {
  screenshotPath: string;
}

/**
 * 공지 스크린샷 이미지 컴포넌트
 * 로딩 상태 및 에러 처리 포함
 */
export function NoticeScreenshotImage({ screenshotPath }: NoticeScreenshotImageProps) {
  const [imageLoading, setImageLoading] = useState(true);
  const [imageError, setImageError] = useState(false);
  // 상대 경로 사용 (Vite 프록시를 통해 백엔드로 전달)
  const imageUrl = `/uploads/${screenshotPath}`;

  if (imageError) {
    return (
      <div className="text-xs text-slate-400 text-center py-2">
        이미지를 불러올 수 없습니다
        <br />
        <span className="text-xs text-slate-500 break-all">{imageUrl}</span>
        <br />
        <button
          onClick={() => {
            setImageError(false);
            setImageLoading(true);
            // 이미지 URL에 타임스탬프 추가하여 캐시 무효화
            const img = new Image();
            img.src = `${imageUrl}?t=${Date.now()}`;
            img.onload = () => {
              setImageLoading(false);
              setImageError(false);
            };
            img.onerror = () => {
              setImageLoading(false);
              setImageError(true);
            };
          }}
          className="mt-2 px-2 py-1 text-xs bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded hover:bg-slate-300 dark:hover:bg-slate-600"
        >
          다시 시도
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2">
      <img
        src={imageUrl}
        alt="공지 이미지"
        className="max-w-full max-h-48 rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer hover:opacity-80 transition-opacity"
        onLoad={() => {
          setImageLoading(false);
          setImageError(false);
        }}
        onError={(e) => {
          console.error('이미지 로딩 실패:', imageUrl, e);
          setImageError(true);
          setImageLoading(false);
        }}
        onClick={() => {
          const newWindow = window.open('', '_blank');
          if (newWindow) {
            newWindow.document.write(`
              <html>
                <head>
                  <title>공지 이미지</title>
                  <style>
                    body {
                      margin: 0;
                      padding: 20px;
                      background: #1e293b;
                      display: flex;
                      justify-content: center;
                      align-items: center;
                      min-height: 100vh;
                    }
                    img {
                      max-width: 100%;
                      max-height: 90vh;
                      border-radius: 8px;
                      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
                    }
                  </style>
                </head>
                <body>
                  <img src="${imageUrl}" alt="공지 이미지" />
                </body>
              </html>
            `);
            newWindow.document.close();
          }
        }}
      />
      {imageLoading && (
        <div className="text-xs text-slate-400 text-center py-2">이미지 로딩 중...</div>
      )}
    </div>
  );
}
