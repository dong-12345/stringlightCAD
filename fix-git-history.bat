@echo off
echo This script will clean large files from git history and force push to remote repository.
echo Make sure you have a backup of your repository before proceeding.
echo.

set /p confirm=Type 'yes' to continue: 
if /i not "%confirm%"=="yes" (
    echo Operation cancelled.
    exit /b
)

echo Removing large files from git history...
git rm -r --cached .
echo Adding files according to .gitignore rules...
git add .
echo Creating new commit...
git commit -m "Remove large build files from history"
echo Force pushing to remote repository...
git push origin main --force

echo.
echo Process completed. Your repository should now be able to push to GitHub.
echo Remember to inform any collaborators about the forced push.
pause