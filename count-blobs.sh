#!/bin/bash

export BLOB_READ_WRITE_TOKEN="vercel_blob_rw_QBD1awGW2y6sZl69_2N8hNjbJdSXiVOuoJhjHjg0tMZ0Kvd"

total=0
cursor=""

echo "Counting files in Vercel Blob Storage..."

while true; do
  if [ -z "$cursor" ]; then
    output=$(npx vercel blob ls 2>&1)
  else
    output=$(npx vercel blob ls --cursor "$cursor" 2>&1)
  fi
  
  # Count lines with .json in them (excluding headers)
  count=$(echo "$output" | grep -c "\.json")
  total=$((total + count))
  
  echo "Batch: $count files (Total so far: $total)"
  
  # Check if there's a next page
  cursor=$(echo "$output" | grep -o "vercel blob list --cursor [^ ]*" | sed 's/vercel blob list --cursor //')
  
  if [ -z "$cursor" ]; then
    break
  fi
  
  sleep 0.5  # Be nice to the API
done

echo ""
echo "Total files uploaded: $total / 15,168"
echo "Progress: $(echo "scale=2; $total * 100 / 15168" | bc)%"

# Estimate time remaining
elapsed_minutes=46  # Started at 1:40 PM, now is 2:26 PM
rate=$(echo "scale=2; $total / $elapsed_minutes" | bc)
remaining=$((15168 - total))
minutes_left=$(echo "scale=0; $remaining / $rate" | bc)

echo "Upload rate: ~$rate files/minute"
echo "Estimated time remaining: ~$minutes_left minutes"
