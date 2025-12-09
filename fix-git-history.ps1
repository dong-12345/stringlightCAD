Write-Host "This script will clean large files from git history and force push to remote repository."
Write-Host "Make sure you have a backup of your repository before proceeding."
Write-Host ""

$confirm = Read-Host "Type 'yes' to continue"
if ($confirm -ne "yes") {
    Write-Host "Operation cancelled."
    exit
}

try {
    Write-Host "Removing large files from git history..."
    git rm -r --cached .
    
    Write-Host "Adding files according to .gitignore rules..."
    git add .
    
    Write-Host "Creating new commit..."
    git commit -m "Remove large build files from history"
    
    Write-Host "Force pushing to remote repository..."
    git push origin main --force
    
    Write-Host ""
    Write-Host "Process completed successfully! Your repository should now be able to push to GitHub." -ForegroundColor Green
    Write-Host "Remember to inform any collaborators about the forced push."
} catch {
    Write-Host "An error occurred: $_" -ForegroundColor Red
}

Read-Host "Press Enter to exit"