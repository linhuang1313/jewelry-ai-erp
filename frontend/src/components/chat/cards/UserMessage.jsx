import React from 'react'

export const UserMessage = ({ content }) => {
  return (
    <div className="flex justify-end">
      <div className="bg-gradient-to-r from-jewelry-navy to-jewelry-navy-light text-white rounded-3xl px-5 py-4 shadow-md max-w-2xl">
        <div className="text-[15px] leading-relaxed whitespace-pre-wrap">{content}</div>
      </div>
    </div>
  )
}

export default UserMessage
