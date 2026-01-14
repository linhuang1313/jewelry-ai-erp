# PowerShell script to set Python 3.10 as default in current session
$python310Path = "C:\Users\hlin2\AppData\Local\Programs\Python\Python310"
$python310ScriptsPath = "C:\Users\hlin2\AppData\Local\Programs\Python\Python310\Scripts"

# Remove Python 3.14 from current session PATH
$env:Path = ($env:Path -split ';' | Where-Object { $_ -and $_ -notmatch 'Python314' }) -join ';'

# Add Python 3.10 to the front of PATH
$env:Path = "$python310Path;$python310ScriptsPath;$env:Path"

Write-Host "Python 3.10 has been set as default for this session" -ForegroundColor Green
Write-Host "Python version:" -ForegroundColor Yellow
python --version







