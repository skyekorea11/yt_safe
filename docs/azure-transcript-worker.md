# Azure Transcript Worker (yt-dlp -> Supabase)

이 워커는 로컬/서버에서 `yt-dlp`로 자막을 추출해 Supabase `videos` 테이블에 저장합니다.

## 1) 이미지 빌드/푸시 (Azure Container Registry)

```bash
# 변수
RG=<resource-group>
LOC=koreacentral
ACR=<acr-name>                  # 예: myacr123
IMAGE=yt-transcript-worker
TAG=v1

az group create -n $RG -l $LOC
az acr create -n $ACR -g $RG --sku Basic
az acr login -n $ACR

docker build -f Dockerfile.transcript-worker -t $ACR.azurecr.io/$IMAGE:$TAG .
docker push $ACR.azurecr.io/$IMAGE:$TAG
```

## 2) Container Apps Environment 준비

```bash
CAE=yt-cae
az containerapp env create -g $RG -n $CAE -l $LOC
```

## 3) 스케줄 Job 생성

```bash
JOB=yt-transcript-sync
SUPABASE_URL=<https://xxxx.supabase.co>
SUPABASE_ANON_KEY=<supabase-anon-key>

az containerapp job create \
  -g $RG -n $JOB \
  --environment $CAE \
  --trigger-type Schedule \
  --cron-expression "0 */1 * * *" \
  --replica-timeout 1800 \
  --replica-retry-limit 1 \
  --parallelism 1 \
  --image $ACR.azurecr.io/$IMAGE:$TAG \
  --registry-server $ACR.azurecr.io \
  --env-vars \
    NEXT_PUBLIC_SUPABASE_URL=$SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY \
    YT_DLP_PATH=yt-dlp \
    YT_DLP_USE_BROWSER_COOKIES=false \
    TRANSCRIPT_SYNC_LIMIT=20
```

## 4) 수동 실행/로그 확인

```bash
# 수동 트리거
az containerapp job start -g $RG -n $JOB

# 최근 실행 목록
az containerapp job execution list -g $RG -n $JOB -o table

# 로그
az containerapp job execution show -g $RG -n $JOB --job-execution-name <execution-name>
```

## 5) 자주 조정하는 변수

- `TRANSCRIPT_SYNC_LIMIT`: 실행당 처리 영상 수 (기본 20)
- `TRANSCRIPT_SYNC_ALL`: `true`면 최근 영상을 자막 상태 무관하게 처리
- `TRANSCRIPT_SYNC_VIDEO_ID`: 특정 영상 1개만 처리
- `YT_DLP_USE_BROWSER_COOKIES`: Azure에서는 보통 `false`

## 로컬 테스트

```bash
npm run transcripts:sync -- --limit=5
npm run transcripts:sync -- --video=<youtubeVideoId>
```

## 앱 런타임(Azure) 연동

Vercel/심사 배포 런타임에서 `yt-dlp` 실행이 막히는 경우를 위해,
앱은 `TRANSCRIPT_SERVICE_URL`이 설정되면 Azure HTTP 서비스를 우선 호출합니다.

### 필요한 환경변수 (App)

- `TRANSCRIPT_SERVICE_URL=https://<your-azure-service-domain>`
- `TRANSCRIPT_SERVICE_TOKEN=<optional-token>`
- `TRANSCRIPT_SERVICE_TIMEOUT_MS=25000` (선택)
- `AZURE_TRANSCRIPT_MAX_CALLS_PER_DAY=120` (권장)
- `AZURE_TRANSCRIPT_MAX_CALLS_PER_MONTH=1500` (권장)
- `AZURE_TRANSCRIPT_CAP_STRICT=true` (권장)

`AZURE_TRANSCRIPT_CAP_STRICT=true`면 사용량 카운트 확인이 실패할 때 Azure 호출을 차단합니다.
(예산 보호 우선)

### Azure 서비스 응답 형식

아래 중 하나를 반환하면 앱에서 자동 인식합니다.

```json
{ "status": "READY", "text": "..." }
```

```json
{ "status": "NOT_AVAILABLE" }
```

```json
{ "success": true, "transcript": "...", "status": "extracted" }
```

지원 엔드포인트 패턴(자동 시도):

- `POST /api/transcripts/:videoId`
- `POST /transcripts/:videoId`
- `POST /api/transcripts` with `{ "videoId": "..." }`
- `POST /transcripts` with `{ "videoId": "..." }`
- `GET /api/transcripts/:videoId`
- `GET /transcripts/:videoId`
