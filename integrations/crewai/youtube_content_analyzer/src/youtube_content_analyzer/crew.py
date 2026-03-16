import os

from crewai import LLM
from crewai import Agent, Crew, Process, Task
from crewai.project import CrewBase, agent, crew, task

from youtube_content_analyzer.tools.youtube_video_extractor import YouTubeVideoExtractorTool




@CrewBase
class YoutubeContentAnalyzerCrew:
    """YoutubeContentAnalyzer crew"""

    
    @agent
    def youtube_video_analyzer(self) -> Agent:
        
        return Agent(
            config=self.agents_config["youtube_video_analyzer"],
            
            
            tools=[				YouTubeVideoExtractorTool()],
            reasoning=False,
            max_reasoning_attempts=None,
            inject_date=True,
            allow_delegation=False,
            max_iter=25,
            max_rpm=None,
            
            
            max_execution_time=None,
            llm=LLM(
                model="openai/gpt-4.1",
                temperature=0.7,
                
            ),
            
        )
    
    @agent
    def content_summarizer(self) -> Agent:
        
        return Agent(
            config=self.agents_config["content_summarizer"],
            
            
            tools=[],
            reasoning=False,
            max_reasoning_attempts=None,
            inject_date=True,
            allow_delegation=False,
            max_iter=25,
            max_rpm=None,
            
            
            max_execution_time=None,
            llm=LLM(
                model="openai/gpt-4.1",
                temperature=0.7,
                
            ),
            
        )
    

    
    @task
    def extract_youtube_video_information(self) -> Task:
        return Task(
            config=self.tasks_config["extract_youtube_video_information"],
            markdown=False,
            
            
        )
    
    @task
    def summarize_video_content(self) -> Task:
        return Task(
            config=self.tasks_config["summarize_video_content"],
            markdown=False,
            
            
        )
    

    @crew
    def crew(self) -> Crew:
        """Creates the YoutubeContentAnalyzer crew"""
        return Crew(
            agents=self.agents,  # Automatically created by the @agent decorator
            tasks=self.tasks,  # Automatically created by the @task decorator
            process=Process.sequential,
            verbose=True,
            chat_llm=LLM(model="openai/gpt-4.1"),
        )


