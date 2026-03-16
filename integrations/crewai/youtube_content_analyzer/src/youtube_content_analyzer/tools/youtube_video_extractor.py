from crewai.tools import BaseTool
from pydantic import BaseModel, Field
from typing import Type, Dict, Any, List
import requests
import json
import urllib.parse
import re
import os

class YouTubeVideoExtractorInput(BaseModel):
    """Input schema for YouTube Video Extractor Tool."""
    youtube_url: str = Field(
        ...,
        description="The YouTube video URL in any format (youtube.com/watch?v=, youtu.be/, etc.)"
    )

class YouTubeVideoExtractorTool(BaseTool):
    """Tool for extracting comprehensive video metadata from YouTube videos using the YouTube Data API v3."""

    name: str = "YouTube Video Info Extractor"
    description: str = (
        "Extracts video metadata from YouTube including title, description, duration, "
        "channel name, and upload date. Supports various YouTube URL formats and "
        "includes comprehensive error handling for invalid URLs and API issues."
    )
    args_schema: Type[BaseModel] = YouTubeVideoExtractorInput

    def _extract_video_id(self, url: str) -> str:
        """
        Extract video ID from various YouTube URL formats.
        
        Args:
            url: YouTube URL in various formats
            
        Returns:
            Video ID string or None if not found
        """
        # Common YouTube URL patterns
        patterns = [
            r'(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]+)',
            r'youtube\.com\/v\/([a-zA-Z0-9_-]+)',
            r'youtube\.com\/watch\?.*v=([a-zA-Z0-9_-]+)',
        ]
        
        for pattern in patterns:
            match = re.search(pattern, url)
            if match:
                return match.group(1)
        
        # Try to extract from query parameters
        try:
            parsed_url = urllib.parse.urlparse(url)
            if parsed_url.hostname in ['www.youtube.com', 'youtube.com']:
                query_params = urllib.parse.parse_qs(parsed_url.query)
                if 'v' in query_params:
                    return query_params['v'][0]
        except Exception:
            pass
        
        return None

    def _format_duration(self, duration: str) -> str:
        """
        Convert ISO 8601 duration to human readable format.
        
        Args:
            duration: ISO 8601 duration string (e.g., PT4M13S)
            
        Returns:
            Human readable duration (e.g., "4:13")
        """
        try:
            # Remove PT prefix
            duration = duration.replace('PT', '')
            
            hours = 0
            minutes = 0
            seconds = 0
            
            # Extract hours
            if 'H' in duration:
                hours = int(duration.split('H')[0])
                duration = duration.split('H')[1]
            
            # Extract minutes
            if 'M' in duration:
                minutes = int(duration.split('M')[0])
                duration = duration.split('M')[1]
            
            # Extract seconds
            if 'S' in duration:
                seconds = int(duration.split('S')[0])
            
            # Format duration
            if hours > 0:
                return f"{hours}:{minutes:02d}:{seconds:02d}"
            else:
                return f"{minutes}:{seconds:02d}"
                
        except Exception:
            return duration

    def _run(self, youtube_url: str) -> str:
        """
        Extract video information from YouTube URL.
        
        Args:
            youtube_url: The YouTube video URL
            
        Returns:
            JSON string with video information
        """
        result = {
            "video_id": None,
            "title": None,
            "description": None,
            "duration": None,
            "channel": None,
            "upload_date": None,
            "success": False,
            "error": None
        }
        
        try:
            # Get API key from environment
            api_key = os.getenv('YOUTUBE_API_KEY')
            if not api_key:
                result["error"] = "YouTube API key not found in environment variables"
                return json.dumps(result, indent=2)
            
            # Extract video ID
            video_id = self._extract_video_id(youtube_url)
            if not video_id:
                result["error"] = "Could not extract video ID from URL. Please check the URL format."
                return json.dumps(result, indent=2)
            
            result["video_id"] = video_id
            
            # Prepare API request
            api_url = "https://www.googleapis.com/youtube/v3/videos"
            params = {
                'part': 'snippet,contentDetails',
                'id': video_id,
                'key': api_key
            }
            
            # Make API request
            response = requests.get(api_url, params=params, timeout=30)
            
            if response.status_code == 403:
                result["error"] = "YouTube API quota exceeded or invalid API key"
                return json.dumps(result, indent=2)
            elif response.status_code == 404:
                result["error"] = "Video not found or is private/unavailable"
                return json.dumps(result, indent=2)
            elif response.status_code != 200:
                result["error"] = f"YouTube API error: HTTP {response.status_code}"
                return json.dumps(result, indent=2)
            
            # Parse response
            data = response.json()
            
            if not data.get('items'):
                result["error"] = "Video not found or is private/unavailable"
                return json.dumps(result, indent=2)
            
            video_data = data['items'][0]
            snippet = video_data.get('snippet', {})
            content_details = video_data.get('contentDetails', {})
            
            # Extract video information
            result["title"] = snippet.get('title', 'N/A')
            result["description"] = snippet.get('description', 'N/A')
            result["channel"] = snippet.get('channelTitle', 'N/A')
            result["upload_date"] = snippet.get('publishedAt', 'N/A')
            
            # Format duration
            duration_raw = content_details.get('duration', '')
            result["duration"] = self._format_duration(duration_raw) if duration_raw else 'N/A'
            
            result["success"] = True
            
        except requests.exceptions.RequestException as e:
            result["error"] = f"Network error: {str(e)}"
        except json.JSONDecodeError:
            result["error"] = "Failed to parse YouTube API response"
        except Exception as e:
            result["error"] = f"Unexpected error: {str(e)}"
        
        return json.dumps(result, indent=2)