#!/bin/bash

echo "Pushing Brisbane Ferry Tracker to GitHub..."
echo "This script will push your code to: https://github.com/thebnut/brisbane-ferry-tracker"
echo ""
echo "You may be prompted for your GitHub username and password/token."
echo "For password, use a Personal Access Token (not your GitHub password)."
echo "Create one at: https://github.com/settings/tokens"
echo ""
echo "Press Enter to continue..."
read

# Push the code
git push -u origin main

echo ""
echo "Push complete! Next steps:"
echo "1. Go to https://github.com/thebnut/brisbane-ferry-tracker/settings/pages"
echo "2. Under 'Source', select 'Deploy from a branch'"
echo "3. Select 'main' branch and '/ (root)' folder"
echo "4. Click Save"
echo ""
echo "5. Go to https://github.com/thebnut/brisbane-ferry-tracker/actions"
echo "6. Click on 'Process Ferry Schedule' workflow"
echo "7. Click 'Run workflow' to generate initial schedule data"