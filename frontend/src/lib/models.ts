export interface ChatMessage {
  id: string;
  sender: "user" | "agent";
  text: string;
  timestamp: string;
}

export interface ModelOption {
  id: string;
  name: string;
  free: boolean;
}

export interface EAVRow {
  entity_id: string;
  entity_name: string;
  attribute: string;
  value: string;
}

export interface ToastState {
  message: string;
  type: "success" | "error" | "info";
}
