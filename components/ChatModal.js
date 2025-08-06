"use client";

import { useState, useRef } from "react";
import {
  MainContainer,
  ChatContainer,
  MessageList,
  Message,
  MessageInput,
  TypingIndicator,
  Avatar,
  ConversationHeader,
} from "@chatscope/chat-ui-kit-react";
import "@chatscope/chat-ui-kit-styles/dist/default/styles.min.css";
import Modal from "./Modal";

export default function ChatModal({
  isOpen,
  onClose,
  profile,
  currentUser = "You",
  conversationType = "roommate", // "roommate" or "landlord"
}) {
  const [messages, setMessages] = useState([
    {
      message:
        conversationType === "landlord"
          ? `Hi! I'm interested in your property listing. Could we discuss the details?`
          : `Hi! I saw your roommate profile and I think we might be a good match. Would you like to chat about potentially being roommates?`,
      sentTime: "just now",
      sender: currentUser,
      direction: "outgoing",
    },
  ]);
  const [isTyping, setIsTyping] = useState(false);
  const messageInputRef = useRef();

  const handleSend = async (innerHtml, textContent) => {
    if (!textContent.trim()) return;

    const newMessage = {
      message: textContent,
      direction: "outgoing",
      sender: currentUser,
      sentTime: "just now",
    };

    setMessages((prevMessages) => [...prevMessages, newMessage]);

    // Simulate typing indicator
    setIsTyping(true);

    // Simulate a response from the other person after a delay
    setTimeout(() => {
      setIsTyping(false);

      const roommateResponses = [
        "Thanks for reaching out! I'd love to learn more about you.",
        "Hi! Yes, I'm definitely interested in finding a roommate. What year are you?",
        "Hey! I saw your profile too and you seem like a great match. When are you looking to move in?",
        "That sounds great! I'm looking for someone who shares similar interests. Tell me about yourself!",
        "Hi there! I'm definitely open to chatting. What dorm or area were you thinking?",
      ];

      const landlordResponses = [
        "Hello! Thank you for your interest in the property. I'd be happy to answer any questions you have.",
        "Hi there! Great to hear from you. What would you like to know about the listing?",
        "Thanks for reaching out! I'm available to discuss the property details and answer any questions.",
        "Hello! I appreciate your interest. When would you be looking to move in?",
        "Hi! I'd be glad to help you with any questions about the rental. What specific information are you looking for?",
      ];

      const responses =
        conversationType === "landlord" ? landlordResponses : roommateResponses;

      const responseMessage = {
        message: responses[Math.floor(Math.random() * responses.length)],
        direction: "incoming",
        sender:
          profile?.name ||
          (conversationType === "landlord" ? "Landlord" : "Roommate"),
        sentTime: "just now",
      };

      setMessages((prevMessages) => [...prevMessages, responseMessage]);
    }, 1500 + Math.random() * 2000); // Random delay between 1.5-3.5 seconds
  };

  const handleAttachment = () => {
    // Handle file attachments if needed
    console.log("Attachment clicked");
  };

  if (!profile) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <div className="h-[600px] w-full max-w-4xl mx-auto">
        <MainContainer>
          <ChatContainer>
            <ConversationHeader>
              <ConversationHeader.Back onClick={onClose} />
              <Avatar
                src={profile.image || "/images/default-profile.jpg"}
                name={profile.name}
              />
              <ConversationHeader.Content
                userName={profile.name}
                info={`${profile.age} years old • ${profile.gender}`}
              />
            </ConversationHeader>

            <MessageList
              scrollBehavior="smooth"
              typingIndicator={
                isTyping ? (
                  <TypingIndicator content={`${profile.name} is typing`} />
                ) : null
              }
            >
              {messages.map((message, i) => (
                <Message
                  key={i}
                  model={{
                    message: message.message,
                    sentTime: message.sentTime,
                    sender: message.sender,
                    direction: message.direction,
                  }}
                >
                  {message.direction === "incoming" && (
                    <Avatar
                      src={profile.image || "/images/default-profile.jpg"}
                      name={profile.name}
                    />
                  )}
                </Message>
              ))}
            </MessageList>

            <MessageInput
              ref={messageInputRef}
              placeholder="Type a message here..."
              onSend={handleSend}
              onAttachmentClick={handleAttachment}
              attachButton={true}
              sendButton={true}
            />
          </ChatContainer>
        </MainContainer>
      </div>
    </Modal>
  );
}
