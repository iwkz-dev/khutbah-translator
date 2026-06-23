# Khutbah Translator - Setup Script untuk Windows
# Jalankan: powershell -ExecutionPolicy Bypass -File install.ps1

param(
    [switch]$SkipOllama = $false,
    [switch]$SkipWhisper = $false
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Khutbah Translator Setup Script" -ForegroundColor Cyan
Write-Host "  Windows Edition" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

function Write-Status {
    param([string]$Message, [string]$Color = "Green")
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $Message" -ForegroundColor $Color
}

function Write-ErrorStatus {
    param([string]$Message)
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] ERROR: $Message" -ForegroundColor Red
    exit 1
}

function Refresh-Path {
    $machinePath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = @($machinePath, $userPath) -join ";"
}

function Test-CommandExists {
    param([string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-AppStartTarget {
    $candidates = @(
        @{ Dir = (Get-Location).Path; Entry = "server.js" },
        @{ Dir = (Join-Path (Get-Location).Path "khutbah-translator\khutbah-translator"); Entry = "server.js" }
    )

    foreach ($candidate in $candidates) {
        $entryPath = Join-Path $candidate.Dir $candidate.Entry
        if (Test-Path $entryPath) {
            return $candidate
        }
    }

    return $null
}

Write-Status "Checking PowerShell version..." "Yellow"
$psVersion = $PSVersionTable.PSVersion.Major
if ($psVersion -lt 5) {
    Write-ErrorStatus "PowerShell 5+ required. Please use Windows PowerShell or PowerShell 7+"
}
Write-Status "PowerShell $psVersion detected"
Write-Host ""

$projectRoot = (Get-Location).Path
$nodeProjectDir = $projectRoot
$appStartTarget = Get-AppStartTarget

Write-Status "Project root: $projectRoot" "Yellow"
if ($appStartTarget) {
    Write-Status "App entrypoint detected at $($appStartTarget.Dir)\$($appStartTarget.Entry)"
} else {
    Write-Status "No runnable server entrypoint found yet. Installer will only prepare dependencies." "Yellow"
}
Write-Host ""

Write-Status "Checking Node.js..." "Yellow"
try {
    $nodeVersion = node --version
    Write-Status "Node.js $nodeVersion installed"
} catch {
    Write-Status "Node.js not found. Installing..." "Yellow"

    $nodeUrl = "https://nodejs.org/dist/v20.10.0/node-v20.10.0-x64.exe"
    $nodeInstaller = "$env:TEMP\node-installer.exe"

    Write-Status "Downloading Node.js..." "Yellow"
    Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeInstaller

    Write-Status "Installing Node.js (click through installer)..." "Yellow"
    Start-Process -FilePath $nodeInstaller -Wait

    Refresh-Path

    if (-not (Test-CommandExists "node")) {
        Write-ErrorStatus "Node.js installer finished, but 'node' is still not available in PATH. Please open a new PowerShell window and run install.ps1 again."
    }

    $nodeVersion = node --version
    Write-Status "Node.js $nodeVersion installed"
}
Write-Host ""

Write-Status "Checking Python..." "Yellow"
try {
    $pythonVersion = python --version
    Write-Status "$pythonVersion installed"
} catch {
    Write-Status "Python not found. Installing..." "Yellow"

    $pythonUrl = "https://www.python.org/ftp/python/3.11.7/python-3.11.7-amd64.exe"
    $pythonInstaller = "$env:TEMP\python-installer.exe"

    Write-Status "Downloading Python..." "Yellow"
    Invoke-WebRequest -Uri $pythonUrl -OutFile $pythonInstaller

    Write-Status "Installing Python (quiet mode, add to PATH)..." "Yellow"
    Start-Process -FilePath $pythonInstaller -ArgumentList "/quiet", "InstallAllUsers=0", "PrependPath=1" -Wait

    Refresh-Path

    if (-not (Test-CommandExists "python")) {
        Write-ErrorStatus "Python installer finished, but 'python' is still not available in PATH. Please open a new PowerShell window and run install.ps1 again."
    }

    $pythonVersion = python --version
    Write-Status "$pythonVersion installed"
}
Write-Host ""

Write-Status "Installing Node.js dependencies..." "Yellow"
try {
    if (-not (Test-Path (Join-Path $nodeProjectDir "package.json"))) {
        Write-ErrorStatus "package.json not found in project root: $nodeProjectDir"
    }

    Push-Location $nodeProjectDir
    try {
        npm install
    } finally {
        Pop-Location
    }

    Write-Status "Node.js dependencies installed"
} catch {
    Write-ErrorStatus "Failed to install Node.js dependencies: $($_.Exception.Message)"
}
Write-Host ""

Write-Status "Installing Python dependencies (Faster-Whisper)..." "Yellow"
try {
    python -m pip install --upgrade pip
    python -m pip install -r python\requirements.txt
    Write-Status "Python dependencies installed"
} catch {
    Write-ErrorStatus "Failed to install Python dependencies: $($_.Exception.Message)"
}
Write-Host ""

if (-not $SkipWhisper) {
    Write-Status "Downloading Whisper model (medium)..." "Yellow"
    try {
        python -c "from faster_whisper import WhisperModel; print('Downloading Whisper medium...'); model = WhisperModel('medium', device='cpu', compute_type='int8'); print('Whisper model ready!')"
        Write-Status "Whisper model downloaded (~1.5GB)"
    } catch {
        Write-ErrorStatus "Failed to download Whisper model: $($_.Exception.Message)"
    }
} else {
    Write-Status "Skipping Whisper model download (--SkipWhisper)" "Yellow"
}
Write-Host ""

if (-not $SkipOllama) {
    Write-Status "Checking Ollama..." "Yellow"

    try {
        $ollamaVersion = ollama --version
        Write-Status "Ollama $ollamaVersion installed"
    } catch {
        Write-Status "Ollama not found. Installing with official PowerShell script..." "Yellow"
        Write-Status "Running: irm https://ollama.com/install.ps1 | iex" "Yellow"

        irm https://ollama.com/install.ps1 | iex

        Refresh-Path
        Write-Status "Waiting for Ollama command to become available..." "Yellow"
        for ($i = 0; $i -lt 30; $i++) {
            try {
                $ollamaVersion = ollama --version
                break
            } catch {
                if ($i -eq 29) {
                    Write-ErrorStatus "Ollama installation finished, but the 'ollama' command is still unavailable"
                }
                Start-Sleep -Seconds 2
                Refresh-Path
            }
        }

        Write-Status "Ollama $ollamaVersion installed"
    }

    Write-Status "Downloading Ollama model (qwen2.5:7b)..." "Yellow"
    try {
        ollama pull qwen2.5:7b
        Write-Status "Ollama model downloaded (~4.5GB)"
    } catch {
        Write-ErrorStatus "Failed to download Ollama model: $($_.Exception.Message)"
    }
} else {
    Write-Status "Skipping Ollama installation (--SkipOllama)" "Yellow"
}
Write-Host ""

Write-Status "Downloading Quran DB from HuggingFace..." "Yellow"
try {
    if (-not (Test-Path "data")) {
        New-Item -ItemType Directory -Path "data" | Out-Null
    }

    node scripts\downloadQuranDB.js
    Write-Status "Quran DB downloaded (~2MB)"
} catch {
    Write-ErrorStatus "Failed to download Quran DB: $($_.Exception.Message)"
}
Write-Host ""

Write-Status "Checking .env..." "Yellow"
if (-not (Test-Path ".env")) {
    Write-Status "Creating .env..." "Yellow"
    @"
# Server
PORT=3000

# Whisper (Faster-Whisper)
WHISPER_MODEL=medium
WHISPER_DEVICE=cpu
WHISPER_COMPUTE_TYPE=int8

# Ollama
OLLAMA_MODEL=qwen2.5:7b
OLLAMA_URL=http://localhost:11434

# Quran DB
QURAN_DB_PATH=data/quran.json
"@ | Out-File -FilePath ".env" -Encoding utf8

    Write-Status ".env created"
} else {
    Write-Status ".env already exists"
}
Write-Host ""

Write-Status "Setup complete." "Yellow"
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Setup Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Software dependencies for the offline v3 stack are installed." -ForegroundColor Yellow
Write-Host "Whisper model : $(if ($SkipWhisper) { 'skipped' } else { 'ready/downloaded' })" -ForegroundColor Yellow
Write-Host "Ollama model  : $(if ($SkipOllama) { 'skipped' } else { 'ready/downloaded' })" -ForegroundColor Yellow
Write-Host "Quran DB      : data/quran.json" -ForegroundColor Yellow
Write-Host ""


