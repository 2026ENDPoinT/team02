# ST mate

ST mate는 서울과학기술대학교 학생을 위한 학습 플래너입니다. 수강 과목과 일정을 관리하고, 과목별 학습 시간을 기록하며, Gemini 기반 AI 친구 "별이"와 대화할 수 있습니다.

## 주요 기능

- eClass 로그인 및 학기별 수강 과목 조회
- 사용자 과목 추가, 수정, 삭제와 성적 관리
- 할 일 및 학사 일정 관리
- 과목별 학습 타이머와 학습 통계
- Gemini 기반 별이 대화 및 학습 조언

## 개발 목표: ENDPoint 2026 구현과제

이 프로젝트는 컴퓨터공학과 해커톤 경진대회 구현과제 트랙의 성적 관리 소프트웨어 목표를 바탕으로 합니다. 아래 다섯 기능을 필수 범위로 두고, 그 외 기능은 자유롭게 확장합니다.

### 필수 구현 기능

1. **과목·성적 등록**: 과목명, 수강 학기, 학점 수, 성적을 입력해 과목을 등록합니다.
2. **과목 조회·관리**: 등록 과목과 성적을 학기별로 조회하고 수정·삭제할 수 있습니다.
3. **평점 자동 계산**: 학기별·전체 누적 GPA와 등록 학점을 계산해 표시합니다.
4. **데이터 저장·불러오기**: 새로고침하거나 프로그램을 다시 실행해도 저장한 데이터를 유지합니다. 본 앱은 Firebase Realtime Database를 사용하여 이를 구현합니다.
5. **기본 예외 처리**: 잘못된 입력이나 데이터가 없는 상황을 오류 없이 적절히 처리합니다. 예를 들어 유효하지 않은 성적, 0 이하의 학점, GPA를 계산할 성적이 없는 경우를 다룹니다.

### GPA 계산 기준

| 성적 | 평점 |
| --- | ---: |
| A+ / A0 | 4.5 / 4.0 |
| B+ / B0 | 3.5 / 3.0 |
| C+ / C0 | 2.5 / 2.0 |
| D+ / D0 | 1.5 / 1.0 |
| F | 0.0 |

`GPA = Σ(과목 학점 × 성적 평점) ÷ GPA 계산 대상 총 학점`으로 계산하며, 4.5 만점 기준 소수점 둘째 자리까지 표시합니다.

### 필수 기능 완료 기준

- 서로 다른 학기의 과목을 구분해 등록하고 조회할 수 있습니다.
- 과목을 추가·수정·삭제하면 목록과 GPA 결과에 반영됩니다.
- 성적 또는 학점 수정 시 GPA가 다시 계산됩니다.
- 프로그램을 재실행해도 저장된 데이터가 유지됩니다.
- 잘못된 입력이나 계산할 성적이 없는 경우에도 앱이 중단되지 않고 적절히 안내합니다.

### 선택 확장 기능 예시

필수 기능을 구현한 뒤 다음과 같은 기능을 선택해 추가할 수 있습니다. 이는 확장 아이디어이며 필수 구현 항목은 아닙니다.

- 시험 점수 등을 활용한 성적 예측
- 목표 GPA 시뮬레이션 및 재수강 시뮬레이션
- 학기별 GPA 변화 시각화
- P/F 과목 관리 및 GPA 제외 처리
- 성적 데이터 CSV 또는 JSON 내보내기
- 사용자 계정과 사용자별 데이터 관리
- 학습 일정 및 과목별 공부 기록

ST mate는 과목 관리와 성적 계산에 더해 할 일 관리, 학습 타이머, 통계, 별이 AI 학습 조언 기능을 확장 기능으로 제공합니다.


## 요구 사항

- Windows 10/11
- Python 3.10 이상
- Git
- Gemini API 키
- Firebase Realtime Database와 Firebase Admin SDK 서비스 계정 키
- 서울과학기술대학교 eClass 계정

## 설치 및 실행

PowerShell에서 프로젝트를 내려받고 프로젝트 폴더로 이동합니다.

```powershell
git clone https://github.com/<GitHub-사용자명>/<저장소명>.git
cd <저장소명>
py -3.10 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
Copy-Item .env.example .env
```

PowerShell에서 가상 환경 활성화가 차단되면 현재 창에서만 실행 정책을 변경한 다음 다시 활성화합니다.

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned
.\.venv\Scripts\Activate.ps1
```

필요한 설정을 마친 뒤 앱을 실행합니다.

```powershell
python main.py
```

## API 및 Firebase 설정

### Gemini

프로젝트 루트의 `.env` 파일을 열고 실제 Gemini API 키를 입력합니다.

```dotenv
GEMINI_API_KEY=여기에_실제_API_키
GEMINI_MODEL=gemini-3.6-flash
```

`GEMINI_MODEL`은 선택 항목입니다. 값을 비워 두면 애플리케이션에 설정된 기본 모델을 사용합니다. 사용할 수 있는 모델과 API 사용량은 본인의 Gemini API 설정에서 확인하세요.

### Firebase

1. Firebase 프로젝트에서 Realtime Database를 설정합니다.
2. 해당 프로젝트의 Firebase Admin SDK 서비스 계정 키(JSON)를 발급합니다.
3. JSON 파일을 프로젝트 루트에 `com-hackathon-firebase-adminsdk-fbsvc-0b2c53509c.json` 이름으로 둡니다.
4. 다른 Firebase 프로젝트를 사용하는 경우 `backend/shared.py`의 `FIREBASE_DATABASE_URL`을 해당 데이터베이스 URL로 변경합니다.

서비스 계정 JSON은 데이터베이스에 대한 관리자 권한을 가질 수 있는 민감한 비밀 파일입니다. GitHub에 올리거나 다른 사람과 공유하지 마세요. `.env`와 서비스 계정 JSON은 `.gitignore`에 등록되어 있습니다.

## GitHub에 업로드하기

### 1. GitHub 저장소 만들기

GitHub에서 새 저장소를 만들고 저장소 이름을 정합니다. 로컬 프로젝트에 이미 파일이 있으므로 GitHub에서 README나 `.gitignore`를 자동 생성하지 않는 빈 저장소로 만드는 것이 간단합니다.

### 2. 프로젝트 폴더에서 Git 초기화 및 커밋

아래 명령을 프로젝트 루트(`README.md`와 `main.py`가 있는 폴더)에서 실행합니다.

```powershell
git init
git add .
git status
```

`git status` 결과에 `.env` 또는 Firebase 서비스 계정 JSON이 올라와 있지 않은지 확인하세요. 확인 후 첫 커밋을 만듭니다.

```powershell
git commit -m "Initial project upload"
git branch -M main
```

### 3. GitHub 저장소 연결 및 업로드

`<GitHub-사용자명>`과 `<저장소명>`을 실제 값으로 바꿔 실행합니다.

```powershell
git remote add origin https://github.com/<GitHub-사용자명>/<저장소명>.git
git push -u origin main
```

이후 변경 사항은 다음과 같이 올릴 수 있습니다.

```powershell
git add .
git commit -m "변경 내용 요약"
git push
```

이미 비밀 키가 GitHub에 업로드된 적이 있다면 파일을 삭제하는 것만으로는 충분하지 않습니다. 해당 키를 즉시 폐기·재발급하고, Git 기록에서도 노출된 키를 제거하세요.

## 의존성

Python 패키지는 [`requirements.txt`](./requirements.txt)에 기록되어 있습니다. 새 가상 환경에 설치할 때 `pip install -r requirements.txt`를 실행하세요.
