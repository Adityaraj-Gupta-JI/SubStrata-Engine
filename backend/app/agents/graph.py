from typing import Annotated, TypedDict
from langgraph.graph import StateGraph, START
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode, tools_condition
from langchain_core.messages import BaseMessage, SystemMessage
from app.agents.llm import get_llm_client

class AgentState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]
    tenant_id: str

SYSTEM_PROMPT = (
    "You are SubStrata Engine's intelligent database agent. Your goal is to manage "
    "Entity-Attribute-Value (EAV) schema operations. Perform safe updates and queries "
    "while respecting database boundaries."
)

def run_agent_workflow(messages: list[BaseMessage], tenant_id: str, api_key: str, tools: list) -> str:
    llm = get_llm_client(api_key=api_key)
    llm_with_tools = llm.bind_tools(tools) if tools else llm

    def chatbot_node(state: AgentState):
        prompt = SystemMessage(content=f"{SYSTEM_PROMPT}\nActive Tenant ID: {state['tenant_id']}")
        response = llm_with_tools.invoke([prompt] + state["messages"])
        return {"messages": [response]}

    workflow = StateGraph(AgentState)
    workflow.add_node("chatbot", chatbot_node)
    workflow.add_edge(START, "chatbot")

    if tools:
        workflow.add_node("tools", ToolNode(tools))
        workflow.add_conditional_edges("chatbot", tools_condition)
        workflow.add_edge("tools", "chatbot")

    graph = workflow.compile()
    final_state = graph.invoke({"messages": messages, "tenant_id": tenant_id})
    return final_state["messages"][-1].content