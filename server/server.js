const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const helmet = require('helmet');
const axios = require('axios');
const compression = require('compression');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const Razorpay = require('razorpay');
const { differenceInDays } = require('date-fns');

// const { differenceInDays } = require('date-fns');

const upload = multer({ storage: multer.memoryStorage() });
const app = express();

// Add middleware to parse JSON bodies
app.use(express.json());

const queryWithRetry = async (queryFn, retries = 3, baseDelay = 1500) => {
  for (let i = 0; i < retries; i++) {
    try {
      const { data, error } = await queryFn();
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      if (i < retries - 1) {
        const delay = baseDelay * Math.pow(2, i); // Exponential backoff
        console.warn(`[${new Date().toISOString()}] Retry ${i + 1}/${retries} for Supabase query (delay: ${delay}ms):`, error.message);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      return { data: null, error };
    }
  }
};


// Create an HTTP server for Express
const server = http.createServer(app);

const FCM_SERVER_KEY = 'BI3k1kAiq4ftHigCl3n2PMlMVBYIKOnXcOBYO6yofifcUTEly5TTFa_msDUYARAqLTaJWmfOO-zaI7CmQ-f1MvA';

// Attach WebSocket server to the same HTTP server, with the /ws path
const wss = new WebSocket.Server({ server, path: '/ws' });

// Track rooms
const rooms = new Map(); // Map of room_id to Set of WebSocket connections


// Notifications

// Notifications

// Use dynamic import for node-fetch
const fetch = require('node-fetch');

async function uploadBase64ToSupabase(base64, bucket, fileName) {
  try {
    // Remove the data URL prefix (e.g., "data:image/jpeg;base64,") and extract the base64 string
    const base64Data = base64.split(',')[1];
    const buffer = Buffer.from(base64Data, 'base64');
    const contentType = base64.includes('pdf') ? 'application/pdf' : 'image/jpeg';

    // Upload the file to the specified bucket
    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(fileName, buffer, { contentType });

    if (error) throw error;

    // Get the public URL for the uploaded file
    const { data: urlData } = supabase.storage
      .from(bucket)
      .getPublicUrl(fileName);

    // Return the public URL
    return urlData.publicUrl; // Should return something like https://<project-id>.supabase.co/storage/v1/object/public/<bucket>/<fileName>
  } catch (error) {
    throw new Error(`Failed to upload file to ${bucket}: ${error.message}`);
  }
}




// // Function to test the POST API (send-notification)
// async function testPostApi() {
//   const fcmToken = 'dppwxaPIRsOG9OxeOYYiex:APA91bGMQOl8kJXxSKBH66_i43K9NNOqrIFAM4RQF6GSFtuCMgI9pDtuiGir_gh6BGzPUKDzj2Yi7yACglmk6IP8ePffYd2qyzyJyS-MSsDWtVwQ0wtozAg'; // Replace with a valid FCM token
//   const title = 'Test Notification';
//   const body = 'This is a test notification from fida';

//   try {
//     const success = await sendNotification(fcmToken, title, body);
//     const response = { success, message: success ? 'Notification sent' : 'Notification failed' };
//     console.log('POST API Response:', response);

//     if (!success) {
//       throw new Error('POST API failed: Notification could not be sent');
//     }

//     return response;
//   } catch (error) {
//     console.error('Error in POST API:', error.message);
//     throw error;
//   }
// }

// // Function to test the PATCH API (update fcm_token in user1 table)
// async function testPatchApi() {
//   const url = `${SUPABASE_URL}/rest/v1/user1?id=eq.1`; // Replace id=eq.1 with your condition
//   const body = {
//     fcm_token: 'dppwxaPIRsOG9OxeOYYiex:APA91bGMQOl8kJXxSKBH66_i43K9NNOqrIFAM4RQF6GSFtuCMgI9pDtuiGir_gh6BGzPUKDzj2Yi7yACglmk6IP8ePffYd2qyzyJyS-MSsDWtVwQ0wtozAg', // Replace with a valid FCM token
//   };

//   try {
//     const response = await fetch(url, {
//       method: 'PATCH',
//       headers: {
//         'Content-Type': 'application/json',
//         'Authorization': `Bearer ${SUPABASE_KEY}`,
//         'apikey': SUPABASE_KEY,
//         'Prefer': 'return=representation',
//       },
//       body: JSON.stringify(body),
//     });

//     const data = await response.json();
//     console.log('PATCH API Response:', data);

//     if (!response.ok) {
//       throw new Error(`PATCH API failed: ${response.status} - ${JSON.stringify(data)}`);
//     }

//     return data;
//   } catch (error) {
//     console.error('Error in PATCH API:', error.message);
//     throw error;
//   }
// }

// // Run the tests
// async function runTests() {
//   try {
//     console.log('Testing PATCH API...');
//     await testPatchApi();

//     console.log('\nTesting POST API...');
//     await testPostApi();
//   } catch (error) {
//     console.error('Test failed:', error.message);
//   }
// }

// // Execute the tests
// runTests();





wss.on('connection', (ws) => {
  console.log('New client connected via /ws');

  ws.on('message', async (message) => {
    console.log(`Received: ${message}`);
    try {
      const parsedMessage = JSON.parse(message);
      const { type, phone_number, event_id, room_id, message: msg } = parsedMessage;

      // Join a room and fetch event details
      if (type === 'join_room' && room_id) {
        // Existing join_room logic (unchanged)
        // Validate UUID format for room_id
        const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
        if (!uuidRegex.test(room_id)) {
          ws.send(JSON.stringify({
            success: false,
            error: 'Invalid room_id format. Must be a valid UUID.',
          }));
          return;
        }

        // Validate phone_number
        if (!phone_number) {
          ws.send(JSON.stringify({
            success: false,
            error: 'Phone number is required',
          }));
          return;
        }

        const phoneRegex = /^\+?[1-9]\d{1,14}$/;
        if (!phoneRegex.test(phone_number)) {
          ws.send(JSON.stringify({
            success: false,
            error: 'Invalid phone_number format. Must be a valid phone number with optional country code.',
          }));
          return;
        }

        // Add the client to the room
        if (!rooms.has(room_id)) {
          rooms.set(room_id, new Set());
        }
        rooms.get(room_id).add(ws);

        // Fetch the associated event_id from chat_rooms
        const { data: chatRoom, error: roomError } = await supabase
          .from('chat_rooms')
          .select('event_id')
          .eq('id', room_id)
          .single();

        if (roomError) {
          console.error('Supabase Fetch Error (chat room):', roomError);
          ws.send(JSON.stringify({
            success: false,
            error: 'Failed to fetch chat room details',
            details: roomError.message,
          }));
          return;
        }

        if (!chatRoom) {
          ws.send(JSON.stringify({
            success: false,
            error: 'Chat room not found',
          }));
          return;
        }

        const eventId = chatRoom.event_id;

        // Fetch event details with associated chat room
        const { data: event, error: fetchError } = await supabase
          .from('event_create')
          .select(`
            event_name,
            start_date,
            end_date,
            organizer_phone_number,
            accepted_members,
            chat_rooms!event_create_id_fkey (id)
          `)
          .eq('id', eventId)
          .single();

        if (fetchError) {
          console.error('Supabase Fetch Error (event):', fetchError);
          ws.send(JSON.stringify({
            success: false,
            error: 'Failed to fetch event details',
            details: fetchError.message,
          }));
          return;
        }

        if (!event) {
          ws.send(JSON.stringify({
            success: false,
            error: 'Event not found',
          }));
          return;
        }

        // Verify user is organizer or accepted member
        const acceptedMembers = event.accepted_members || [];
        const isAuthorized =
          event.organizer_phone_number === phone_number || acceptedMembers.includes(phone_number);

        if (!isAuthorized) {
          // Remove the client from the room if unauthorized
          rooms.get(room_id).delete(ws);
          if (rooms.get(room_id).size === 0) rooms.delete(room_id);
          ws.send(JSON.stringify({
            success: false,
            error: 'You are not authorized to view this event',
          }));
          return;
        }

        // Format response (same as /api/chat/event/:event_id)
        ws.send(JSON.stringify({
          success: true,
          data: {
            event_name: event.event_name || 'Unnamed Event',
            start_date: event.start_date || 'N/A',
            end_date: event.end_date || 'N/A',
            room_id: event.chat_rooms && event.chat_rooms.length > 0 ? event.chat_rooms[0].id : null,
          },
        }));
        return;
      }

      // Fetch messages for a chat room

// Handle fetch_messages
if (type === 'fetch_messages' && room_id && phone_number) {
  // Step 1: Input Validation
  if (!room_id || !phone_number) {
    ws.send(JSON.stringify({
      success: false,
      error: 'room_id and phone_number are required',
    }));
    return;
  }

  // Validate UUID format for room_id
  const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  if (!uuidRegex.test(room_id)) {
    ws.send(JSON.stringify({
      success: false,
      error: 'Invalid room_id format. Must be a valid UUID.',
    }));
    return;
  }

  // Validate phone_number format
  const phoneRegex = /^\+?[1-9]\d{1,14}$/;
  if (!phoneRegex.test(phone_number)) {
    ws.send(JSON.stringify({
      success: false,
      error: 'Invalid phone_number format. Must be a valid phone number with optional country code.',
    }));
    return;
  }

  // Step 2: Verify user access by checking the associated event
  const { data: chatRoom, error: roomError } = await supabase
    .from('chat_rooms')
    .select(`
      event_id,
      event_create!event_create_id_fkey (
        organizer_phone_number,
        accepted_members,
        start_date
      )
    `)
    .eq('id', room_id)
    .single();

  if (roomError) {
    console.error('Supabase Fetch Error (chat room):', roomError);
    ws.send(JSON.stringify({
      success: false,
      error: 'Failed to fetch chat room details',
      details: roomError.message,
    }));
    return;
  }

  if (!chatRoom || !chatRoom.event_create) {
    ws.send(JSON.stringify({
      success: false,
      error: 'Chat room or associated event not found',
    }));
    return;
  }

  const event = chatRoom.event_create;
  const acceptedMembers = event.accepted_members || [];
  const isAuthorized =
    event.organizer_phone_number === phone_number || acceptedMembers.includes(phone_number);

  if (!isAuthorized) {
    ws.send(JSON.stringify({
      success: false,
      error: 'You are not authorized to view messages in this chat room',
    }));
    return;
  }

  // Step 3: Fetch all messages in the room
  const { data: messages, error: messagesError } = await supabase
    .from('chat_messages')
    .select('id, room_id, phone_number, message, timestamp')
    .eq('room_id', room_id)
    .order('timestamp', { ascending: true });

  if (messagesError) {
    console.error('Supabase Query Error:', messagesError);
    ws.send(JSON.stringify({
      success: false,
      error: 'Failed to fetch messages',
      details: messagesError.message,
    }));
    return;
  }

  // Step 4: Fetch company names from company_registration
  const { data: companyData, error: companyError } = await supabase
    .from('company_registration')
    .select('phone_number, company_name');
  if (companyError) {
    console.error('Supabase Fetch Error (company):', companyError);
  }
  const companyMap = companyData.reduce((map, company) => {
    map[company.phone_number] = company.company_name;
    return map;
  }, {});

  // Step 5: Fetch user names from user1
  const { data: userData, error: userError } = await supabase
    .from('user1')
    .select('phone_number, first_name, last_name');
  if (userError) {
    console.error('Supabase Fetch Error (user):', userError);
  }
  const userMap = userData.reduce((map, user) => {
    map[user.phone_number] = `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Unknown User';
    return map;
  }, {});

  // Step 6: Enrich messages with sender details
  const enrichedMessages = messages.map(msg => {
    let senderName = 'Unknown';
    let senderType = 'unknown';

    if (companyMap[msg.phone_number]) {
      senderName = companyMap[msg.phone_number];
      senderType = 'organizer';
    } else if (userMap[msg.phone_number]) {
      senderName = userMap[msg.phone_number];
      senderType = 'gig_worker';
    }

    return {
      ...msg,
      sender_name: senderName,
      sender_type: senderType,
    };
  });

  // Step 7: Format and send response
  ws.send(JSON.stringify({
    success: true,
    message: enrichedMessages.length > 0 ? 'Messages fetched successfully' : 'No messages found',
    data: {
      event_start_date: event.start_date || 'N/A',
      messages: enrichedMessages,
    },
  }));
  return;
}


        
    // Update fetch_chat_rooms to include start_time and end_time
else if (type === 'fetch_chat_rooms' && phone_number) {
  const { data: allEvents, error: fetchError } = await supabase
    .from('event_create')
    .select(`
      id,
      event_name,
      organizer_phone_number,
      accepted_members,
      start_date,
      end_date,
      start_time,
      end_time,
      status,
      chat_rooms!event_create_id_fkey (id, room_name)
    `)
    .or(`organizer_phone_number.eq.${phone_number},accepted_members.cs.{${phone_number}}`);

  if (fetchError || !allEvents) {
    ws.send(JSON.stringify({
      success: false,
      error: 'Failed to fetch events',
    }));
    return;
  }

  const eventsWithChatRooms = await Promise.all(
    allEvents
      .filter(event => (event.accepted_members || []).length > 0)
      .map(async (event) => {
        let chatRoom = event.chat_rooms && event.chat_rooms.length > 0 ? event.chat_rooms[0] : null;
        if (!chatRoom) {
          const { data: newChatRoom, error: chatRoomError } = await supabase
            .from('chat_rooms')
            .insert([{ event_id: event.id, room_name: `${event.event_name} Chat Room` }])
            .select('id, room_name')
            .single();
          if (chatRoomError) return null;
          chatRoom = newChatRoom;
        }
        return { ...event, chat_room: chatRoom };
      })
  );

  const validEvents = eventsWithChatRooms.filter(event => event !== null);
  const upcomingEvents = [];
  const completedEvents = [];
  const currentDate = new Date();

  validEvents.forEach(event => {
    const acceptedMembers = event.accepted_members || [];
    const totalMembers = (event.organizer_phone_number ? 1 : 0) + acceptedMembers.length;
    const eventDetails = {
      id: event.id,
      room_id: event.chat_room.id,
      event_name: event.event_name || 'Unnamed Event',
      start_date: event.start_date ? event.start_date.split('-').slice(1).join('/') : 'N/A',
      end_date: event.end_date ? event.end_date.split('-').slice(1).join('/') : 'N/A',
      start_time: event.start_time || null,
      end_time: event.end_time || null,
      total_members: totalMembers,
      organizer_phone_number: event.organizer_phone_number || 'N/A',
      accepted_members: acceptedMembers,
      status: event.status || 'upcoming',
    };
    const endDate = new Date(event.end_date || '1970-01-01');
    if (event.end_time || endDate < currentDate) completedEvents.push(eventDetails);
    else upcomingEvents.push(eventDetails);
  });

  ws.send(JSON.stringify({
    success: true,
    message: 'Chat rooms fetched successfully',
    data: { upcoming_events: upcomingEvents, completed_events: completedEvents },
  }));
}
      // Fetch event details (updated to match /api/chat/event-details/:event_id)
      else if (type === 'get_event_details' && event_id && phone_number) {
        // Input validation
        if (!event_id || !phone_number) {
          ws.send(JSON.stringify({
            success: false,
            error: 'Event ID and phone number are required',
          }));
          return;
        }

        // Fetch event details with chat room
        const { data: event, error: eventError } = await supabase
          .from('event_create')
          .select(`
            event_name,
            additional_details,
            organizer_phone_number,
            accepted_members,
            chat_rooms!event_create_id_fkey (id)
          `)
          .eq('id', event_id)
          .single();

        if (eventError) {
          console.error('Supabase Fetch Error (event):', eventError);
          ws.send(JSON.stringify({
            success: false,
            error: 'Failed to fetch event details',
            details: eventError.message,
          }));
          return;
        }

        if (!event) {
          ws.send(JSON.stringify({
            success: false,
            error: 'Event not found',
          }));
          return;
        }

        // Verify user is organizer or accepted member
        const acceptedMembers = event.accepted_members || [];
        const isAuthorized =
          event.organizer_phone_number === phone_number || acceptedMembers.includes(phone_number);

        if (!isAuthorized) {
          ws.send(JSON.stringify({
            success: false,
            error: 'You are not authorized to view this event',
          }));
          return;
        }

        // Fetch crew member details
        const { data: crewMembers, error: crewError } = await supabase
          .from('user1')
          .select('phone_number, first_name, last_name, profile_pic')
          .in('phone_number', acceptedMembers);

        if (crewError) {
          console.error('Supabase Fetch Error (crew):', crewError);
          ws.send(JSON.stringify({
            success: false,
            error: 'Failed to fetch crew members',
            details: crewError.message,
          }));
          return;
        }

        // Format response
        ws.send(JSON.stringify({
          success: true,
          data: {
            event_name: event.event_name || 'Unnamed Event',
            description: event.additional_details || 'No description available',
            room_id: event.chat_rooms && event.chat_rooms.length > 0 ? event.chat_rooms[0].id : null,
            selected_crew: crewMembers.map(member => ({
              phone_number: member.phone_number,
              first_name: member.first_name || 'N/A',
              last_name: member.last_name || 'N/A',
              profile_pic: member.profile_pic || null,
            })),
          },
        }));
        return;
      }

      // Handle Send Message with room-specific broadcasting
     // Inside wss.on('connection', ws.on('message', ...))
else if (type === 'send_message' && room_id && phone_number && msg) {
  const { data: chatRoom, error: roomError } = await supabase
    .from('chat_rooms')
    .select(`
      event_id,
      event_create!chat_rooms_event_id_fkey (
        organizer_phone_number,
        accepted_members,
        organizer_name,
        gig_workers (name, phone_number)
      )
    `)
    .eq('id', room_id)
    .single();

  if (roomError || !chatRoom) {
    ws.send(JSON.stringify({
      success: false,
      error: 'Chat room not found',
    }));
    return;
  }

  const event = chatRoom.event_create;
  const acceptedMembers = event.accepted_members || [];
  const isAuthorized = event.organizer_phone_number === phone_number || acceptedMembers.includes(phone_number);

  if (!isAuthorized) {
    ws.send(JSON.stringify({
      success: false,
      error: 'You are not authorized to send messages in this chat room',
    }));
    return;
  }

  const { data, error } = await supabase
    .from('chat_messages')
    .insert([{ room_id, phone_number, message: msg }])
    .select()
    .single();

  if (error) {
    ws.send(JSON.stringify({
      success: false,
      error: 'Failed to send message',
    }));
    return;
  }

  // Map sender name
  const organizerName = event.organizer_name || 'Unknown Organizer';
  const gigWorkersMap = (event.gig_workers || []).reduce((map, worker) => {
    map[worker.phone_number] = worker.name || 'Unknown Gig Worker';
    return map;
  }, {});
  const senderName = phone_number === event.organizer_phone_number ? organizerName : (gigWorkersMap[phone_number] || 'Unknown');

  const roomClients = rooms.get(room_id) || new Set();
  roomClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: 'new_message',
        room_id,
        phone_number,
        sender_name: senderName, // Add sender name
        message: msg,
        timestamp: data.timestamp,
      }));
    }
  });
}
      // Handle unprocessed message types
      else {
        ws.send(JSON.stringify({
          success: false,
          error: `Unsupported message type: ${type}`,
        }));
      }

    } catch (err) {
      console.error('Error handling WebSocket message:', err);
      ws.send(JSON.stringify({
        success: false,
        error: 'Internal server error',
        details: err.message,
      }));
    }
  });

  ws.on('close', () => {
    rooms.forEach((clients, roomId) => {
      if (clients.has(ws)) {
        clients.delete(ws);
        if (clients.size === 0) rooms.delete(roomId);
      }
    });
    console.log('Client disconnected');
  });
});



// Middleware
app.use(cors());
app.use(express.json());
app.use(helmet());
app.use(compression());

// Supabase setup
// const supabaseUrl = 'https://qqfjpmhfdgftyvnguxmt.supabase.co';
// const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFxZmpwbWhmZGdmdHl2bmd1eG10Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjY3NTg5NjAsImV4cCI6MjA0MjMzNDk2MH0.r4SJj6jw-VmDbNl_k_Mol5myOv2yqopbf5zJnrF3Rkc';
// const supabase = createClient(supabaseUrl, supabaseKey);

const supabaseUrl = 'https://bulearmbgarmitcxkqfk.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ1bGVhcm1iZ2FybWl0Y3hrcWZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkwMzI3NzcsImV4cCI6MjA3NDYwODc3N30.3wHmCJhzVrGXV63-u3eCSuNZsa2td0SUkh5lwfXG_a4';
const supabase = createClient(supabaseUrl, supabaseKey);


// Add this function near the top of server.js, after the Supabase setup



// start event and end event

app.post('/api/v1/company/register', async (req, res) => {
  try {
    const {
      company_name,
      company_address,
      contact_person_name,
      phone_number,
      email_id,
      account_number,
      ifsc_code,
      bank_name,
      gst_number,
      company_profile, // Will accept Base64 data
    } = req.body;

    // Check if all required fields are provided
    if (!company_name || !company_address || !contact_person_name || !phone_number || !email_id) {
      return res.status(400).json({
        success: false,
        error: 'Company name, address, contact person name, phone number, and email are required.',
      });
    }

    // Handle company_profile upload if provided as Base64
    let companyProfileUrl = company_profile;
    if (company_profile && company_profile.startsWith('data:image')) {
      companyProfileUrl = await uploadBase64ToSupabase(
        company_profile,
        'company_profiles', // Bucket name for company profiles
        `profile_${phone_number}_${Date.now()}.jpg` // Unique filename
      );
      if (!companyProfileUrl) {
        return res.status(500).json({
          success: false,
          error: 'Failed to upload company profile image',
        });
      }
    }

    // Insert data into Supabase
    const { data, error } = await supabase
      .from('company_registration')
      .insert([
        {
          company_name,
          company_address,
          contact_person_name,
          phone_number,
          email_id,
          ...(account_number && { account_number }), // Include only if provided
          ...(ifsc_code && { ifsc_code }),           // Include only if provided
          ...(bank_name && { bank_name }),           // Include only if provided
          ...(gst_number && { gst_number }),         // Include only if provided
          company_profile: companyProfileUrl,        // Store the URL or null if no upload
        }
      ])
      .select('*'); // To return the inserted row

    if (error) {
      console.error('Supabase Insert Error:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Failed to register company',
      });
    }

    res.status(201).json({
      success: true,
      message: 'Company registered successfully',
      company: data[0],
    });
  } catch (error) {
    console.error('Error registering company:', error.message);
    res.status(500).json({
      success: false,
      error: 'Server error occurred',
    });
  }
});





app.post('/api/events/start', async (req, res) => {
  const { event_id } = req.body;

  if (!event_id) {
    return res.status(400).json({
      success: false,
      error: 'Event ID missing in body',
    });
  }

  const { data: event, error: eventError } = await supabase
    .from('event_create')
    .select('organizer_phone_number')
    .eq('id', event_id)
    .single();

  if (eventError || !event) {
    return res.status(404).json({
      success: false,
      error: 'Event not found',
    });
  }

  const startTime = new Date().toISOString();
  const { data, error } = await supabase
    .from('event_create')
    .update({ start_time: startTime })
    .eq('id', event_id)
    .select();

  if (error) {
    console.error('Supabase Error:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to start event',
      details: error.message,
    });
  }

  res.status(200).json({
    success: true,
    message: 'Event started successfully',
    data: {
      event_name: data[0].event_name || 'Unnamed Event',
      start_time: startTime,
    },
  });
});

app.post('/api/events/end', async (req, res) => {
  const { event_id } = req.body;

  if (!event_id) {
    return res.status(400).json({
      success: false,
      error: 'Event ID missing in body',
    });
  }

  const { data: event, error: eventError } = await supabase
    .from('event_create')
    .select('organizer_phone_number, start_time')
    .eq('id', event_id)
    .single();

  if (eventError || !event) {
    return res.status(404).json({
      success: false,
      error: 'Event not found',
    });
  }

  if (!event.start_time) {
    return res.status(400).json({
      success: false,
      error: 'Event must be started before it can be ended',
    });
  }

  const endTime = new Date().toISOString();
  const { data, error } = await supabase
    .from('event_create')
    .update({ end_time: endTime, status: 'completed' })
    .eq('id', event_id)
    .select();

  if (error) {
    console.error('Supabase Error:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to end event',
      details: error.message,
    });
  }

  res.status(200).json({
    success: true,
    message: 'Event ended successfully',
    data: {
      event_name: data[0].event_name || 'Unnamed Event',
      end_time: endTime,
    },
  });
});


// GIG WORKERS AND COMPANY PROFILE
//check
app.post('/api/v1/user/check-details', async (req, res) => {
  try {
    const { phonenumber } = req.body;

    if (!phonenumber) {
      return res.status(400).json({
        success: false,
        error: 'Phone number is required',
      });
    }

    // Check if user exists and fetch all fields
    const { data: user, error: fetchError } = await supabase
      .from('user1')
      .select('*')
      .eq('phone_number', phonenumber)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return res.status(404).json({
          success: false,
          exists: false,
          error: 'User not found',
        });
      }
      throw fetchError;
    }

    // Fields to check for completeness (excluding profile_pic as it might be optional)
    const requiredFields = [
      'first_name',
      'last_name',
      'email',
      'location',
      'gender',
      'dob',
      'age',
      'experience',
      'aadhar_file',
      'user_type',
      'average_rating',
      'upi_id',
    ];

    // Identify missing fields
    const missingFields = requiredFields.filter((field) => !user[field]);

    // Determine if all required fields are present
    const isComplete = missingFields.length === 0;

    res.status(200).json({
      success: true,
      exists: true,
      isComplete,
      missingFields,
      userDetails: {
        ...user, // Spread all user fields including profile_pic and any other columns
      },
    });

  } catch (error) {
    console.error('Error checking user details:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});


app.post('/api/v1/user/register-phone', async (req, res) => {
  try {
    const { phonenumber } = req.body;

    if (!phonenumber) {
      return res.status(400).json({
        success: false,
        error: 'Phone number is required',
      });
    }

    // Normalize phone number
    const normalizedPhone = phonenumber.trim();

    // Phone number format validation
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    if (!phoneRegex.test(normalizedPhone)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid phone number format',
      });
    }

    // Step 1: Check if the phone number exists in company_registration table (Organizer)
    const { data: company, error: companyError } = await supabase
      .from('company_registration')
      .select('phone_number')
      .eq('phone_number', normalizedPhone)
      .maybeSingle();

    if (companyError) {
      throw companyError;
    }

    if (company) {
      return res.status(200).json({
        success: true,
        message: 'Phone number already registered as Organizer',
        userType: 'Organizer',
      });
    }

    // Step 2: Check event_create table for various member arrays
    const { data: events, error: eventsError } = await supabase
      .from('event_create')
      .select('applied_members, saved, accepted_members, rejected_members');

    if (eventsError) {
      throw eventsError;
    }

    let isGigWorkerFromEvents = false;
    if (events && events.length > 0) {
      for (const event of events) {
        const appliedMembers = event.applied_members || [];
        const savedMembers = event.saved || [];
        const acceptedMembers = event.accepted_members || [];
        const rejectedMembers = event.rejected_members || [];

        if (
          appliedMembers.includes(normalizedPhone) ||
          savedMembers.includes(normalizedPhone) ||
          acceptedMembers.includes(normalizedPhone) ||
          rejectedMembers.includes(normalizedPhone)
        ) {
          isGigWorkerFromEvents = true;
          break;
        }
      }
    }

    // Step 3: Check user1 table and update based on first_name and last_name
    const { data: existingUser, error: userCheckError } = await supabase
      .from('user1')
      .select('phone_number, user_type, first_name, last_name')
      .eq('phone_number', normalizedPhone)
      .maybeSingle();

    if (userCheckError) {
      throw userCheckError;
    }

    if (existingUser) {
      // If user exists and has first_name and last_name, set as Gig Worker
      if (existingUser.first_name && existingUser.last_name) {
        if (existingUser.user_type !== 'Gig Worker') {
          // Update user_type to Gig Worker
          const { data: updatedUser, error: updateError } = await supabase
            .from('user1')
            .update({ user_type: 'Gig Worker' })
            .eq('phone_number', normalizedPhone)
            .select('phone_number, user_type')
            .single();

          if (updateError) {
            throw updateError;
          }

          return res.status(200).json({
            success: true,
            message: 'Phone number updated to Gig Worker based on profile completion',
            userType: 'Gig Worker',
            data: updatedUser,
          });
        }

        return res.status(200).json({
          success: true,
          message: 'Phone number already registered as Gig Worker',
          userType: 'Gig Worker',
        });
      }

      // If user exists but no first_name/last_name, return current user_type
      return res.status(200).json({
        success: true,
        message: 'Phone number already registered',
        userType: existingUser.user_type || null,
      });
    }

    // Step 4: New user registration
    if (isGigWorkerFromEvents) {
      // Register as Gig Worker if found in event arrays
      const { data: newUser, error: insertError } = await supabase
        .from('user1')
        .insert([{ 
          phone_number: normalizedPhone,
          user_type: 'Gig Worker'
        }])
        .select('phone_number, user_type')
        .single();

      if (insertError) {
        throw insertError;
      }

      return res.status(201).json({
        success: true,
        message: 'Phone number registered as Gig Worker',
        userType: 'Gig Worker',
        data: newUser,
      });
    }

    // Register new user with null userType
    const { data: newUser, error: insertError } = await supabase
      .from('user1')
      .insert([{ 
        phone_number: normalizedPhone,
        user_type: null
      }])
      .select('phone_number, user_type')
      .single();

    if (insertError) {
      throw insertError;
    }

    return res.status(201).json({
      success: true,
      message: 'Phone number successfully registered',
      userType: null,
      data: newUser,
    });

  } catch (error) {
    console.error('Error during phone registration:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Registration failed',
    });
  }
});

app.delete("/api/delete-event/:eventId", async (req, res) => {
  try {
    const { eventId } = req.params;

    // 1. Get event details
    const { data: event, error: eventError } = await supabase
      .from("event_create")
      .select("id, start_date, accepted_members")
      .eq("id", eventId)
      .single();

    if (eventError || !event) {
      return res.status(404).json({
        success: false,
        error: "Event not found",
      });
    }

    // 2. Check if event is at least 3 days away
    const today = new Date();
    const startDate = new Date(event.start_date);
    const diffDays = Math.ceil((startDate - today) / (1000 * 60 * 60 * 24));

    if (diffDays < 3) {
      return res.status(400).json({
        success: false,
        error: "Events within 3 days cannot be deleted",
      });
    }

    // 3. Get related applications (to delete uploads)
    const { data: applications, error: appError } = await supabase
      .from("event_applications")
      .select("id, uploads")
      .eq("event_id", eventId);

    if (appError) {
      console.error("Fetch applications error:", appError);
    }

    // 4. Delete images from storage
    if (applications && applications.length > 0) {
      for (const app of applications) {
        if (app.uploads && Array.isArray(app.uploads)) {
          for (const filePath of app.uploads) {
            const { error: storageError } = await supabase.storage
              .from("event_uploads")
              .remove([filePath]);

            if (storageError) {
              console.error("Storage delete error:", storageError.message);
            }
          }
        }
      }
    }

    // 5. Delete applications
    await supabase.from("event_applications").delete().eq("event_id", eventId);

    // 6. Delete event itself
    const { error: deleteError } = await supabase
      .from("event_create")
      .delete()
      .eq("id", eventId);

    if (deleteError) {
      return res.status(500).json({
        success: false,
        error: "Failed to delete event",
        details: deleteError.message,
      });
    }

    res.status(200).json({
      success: true,
      message: "Event and related data deleted successfully",
    });
  } catch (err) {
    console.error("Server Error:", err);
    res.status(500).json({
      success: false,
      error: "Server error",
      details: err.message,
    });
  }
});


app.post('/api/company/register', async (req, res) => {
  try {
    const {
      company_name,
      company_address,
      contact_person_name,
      phone_number,
      email_id,
      account_number,
      ifsc_code,
      bank_name,
      gst_number,
      company_profile, // Will accept Base64 data
    } = req.body;

    // Check if all required fields are provided
    if (!company_name || !company_address || !contact_person_name || !phone_number || !email_id || !account_number || !ifsc_code || !bank_name || !gst_number) {
      return res.status(400).json({
        success: false,
        error: 'All fields except company_profile are required.',
      });
    }

    // Step 1: Check if the phone number exists in deleted_numbers table
    const { data: deletedNumber, error: deletedError } = await supabase
      .from('deleted_numbers')
      .select('phone_number')
      .eq('phone_number', phone_number)
      .maybeSingle();

    if (deletedError) {
      console.error('Error checking deleted_numbers table:', deletedError.message);
      return res.status(500).json({
        success: false,
        error: 'Error checking deleted numbers',
      });
    }

    // Step 2: If phone number is found in deleted_numbers, block registration
    if (deletedNumber) {
      return res.status(403).json({
        success: false,
        error: 'Account has been deleted, you cannot register a company with this number',
      });
    }

    // Step 3: Proceed with company registration
    // Handle company_profile upload if provided as Base64
    let companyProfileUrl = company_profile;
    if (company_profile && company_profile.startsWith('data:image')) {
      companyProfileUrl = await uploadBase64ToSupabase(
        company_profile,
        'company_profiles', // Bucket name for company profiles
        `profile_${phone_number}_${Date.now()}.jpg` // Unique filename
      );
      if (!companyProfileUrl) {
        return res.status(500).json({
          success: false,
          error: 'Failed to upload company profile image',
        });
      }
    }

    // Insert data into Supabase
    const { data, error } = await supabase
      .from('company_registration')
      .insert([
        {
          company_name,
          company_address,
          contact_person_name,
          phone_number,
          email_id,
          account_number,
          ifsc_code,
          bank_name,
          gst_number,
          company_profile: companyProfileUrl, // Store the URL or null if no upload
        }
      ])
      .select('*'); // To return the inserted row

    if (error) {
      console.error('Supabase Insert Error:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Failed to register company',
      });
    }

    res.status(201).json({
      success: true,
      message: 'Company registered successfully',
      company: data[0],
    });
  } catch (error) {
    console.error('Error registering company:', error.message);
    res.status(500).json({
      success: false,
      error: 'Server error occurred',
    });
  }
});

// Placeholder for uploadBase64ToSupabase function (replace with your implementation)


// to fetch user details
app.get('/api/v1/user/profile', async (req, res) => {
  try {
    const { phone_number } = req.query;

    // Validate input
    if (!phone_number) {
      return res.status(400).json({
        success: false,
        error: 'Phone number is required',
      });
    }

    // Fetch user profile from Supabase with all columns
    const { data: user, error } = await supabase
      .from('user1')
      .select('phone_number, first_name, last_name, email, location, gender, dob, age, experience, profile_pic, aadhar_file, user_type, average_rating, upi_id')
      .eq('phone_number', phone_number)
      .single();

    if (error || !user) {
      return res.status(404).json({
        success: false,
        error: 'User profile not found',
      });
    }

    // Format response
    res.status(200).json({
      success: true,
      message: 'Profile fetched successfully',
      data: {
        phone_number: user.phone_number,
        first_name: user.first_name || '',
        last_name: user.last_name || '',
        email: user.email || '',
        location: user.location || '',
        gender: user.gender || '',
        dob: user.dob || '',
        age: user.age || null,
        experience: user.experience || '',
        profile_pic: user.profile_pic || null,
        aadhar_file: user.aadhar_file || null,
        user_type: user.user_type || null,
        average_rating: user.average_rating || null, // Added new field
        upi_id: user.upi_id || null,                // Added new field
      },
    });
  } catch (error) {
    console.error('Error fetching user profile:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});


 app.put('/api/v1/user/:phone_number/update-details', upload.fields([
  { name: 'profile_pic', maxCount: 1 },
  { name: 'aadhar_file', maxCount: 1 },
]), async (req, res) => {
  try {
    const { phone_number } = req.params;
    const {
      first_name,
      last_name,
      email,
      location,
      gender,
      dob,
      age,
      experience,
      user_type,
      upi_id
    } = req.body;

    // Convert uploaded files to base64 (optional)
    let profilePicUrl = null;
    if (req.files['profile_pic']) {
      const file = req.files['profile_pic'][0];
      const base64 = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
      profilePicUrl = await uploadBase64ToSupabase(base64, 'profile_pics', `profile_${phone_number}_${Date.now()}.jpg`);
    }

    let aadharFileUrl = null;
    if (req.files['aadhar_file']) {
      const file = req.files['aadhar_file'][0];
      const base64 = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
      aadharFileUrl = await uploadBase64ToSupabase(base64, 'aadhar_files', `aadhar_${phone_number}_${Date.now()}.pdf`);
    }

    // Build update object dynamically
    const updateData = {};
    if (first_name) updateData.first_name = first_name;
    if (last_name) updateData.last_name = last_name;
    if (email) updateData.email = email;
    if (location) updateData.location = location;
    if (gender) updateData.gender = gender;
    if (dob) updateData.dob = dob;
    if (profilePicUrl) updateData.profile_pic = profilePicUrl;
    if (aadharFileUrl) updateData.aadhar_file = aadharFileUrl;
    if (age) updateData.age = age;
    if (experience) updateData.experience = experience;
    if (user_type) updateData.user_type = user_type;
    if (upi_id) updateData.upi_id = upi_id;

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No fields provided to update',
      });
    }

    const { data, error } = await supabase
      .from('user1')
      .update(updateData)
      .eq('phone_number', phone_number)
      .select()
      .single();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    res.status(200).json({
      success: true,
      message: 'User details updated successfully',
      data,
    });
  } catch (error) {
    console.error('Update error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Update failed',
    });
  }
});

app.put('/api/v1/user/profile', async (req, res) => {
  try {
    const {
      phone_number,
      email,
      location,
      profile_pic,
      upi_id,
    } = req.body;

    // Validate input
    if (!phone_number) {
      return res.status(400).json({
        success: false,
        error: 'Phone number is required',
      });
    }

    // Check if user exists
    const { data: existingUser, error: fetchError } = await supabase
      .from('user1')
      .select('phone_number')
      .eq('phone_number', phone_number)
      .single();

    if (fetchError || !existingUser) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    // Handle profile_pic upload if provided as Base64
    let profilePicUrl = profile_pic;
    if (profile_pic && profile_pic.startsWith('data:image')) {
      profilePicUrl = await uploadBase64ToSupabase(
        profile_pic,
        'profile_pics',
        `profile_${phone_number}_${Date.now()}.jpg`
      );
    }

    // Prepare update data (only include editable fields: email, location, profile_pic, upi_id)
    const updateData = {};
    if (email !== undefined) updateData.email = email;
    if (location !== undefined) updateData.location = location;
    if (profilePicUrl !== undefined) updateData.profile_pic = profilePicUrl;
    if (upi_id !== undefined) updateData.upi_id = upi_id;

    // Check if there's anything to update
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No editable fields provided to update',
      });
    }

    // Update user profile in Supabase
    const { data: updatedUser, error: updateError } = await supabase
      .from('user1')
      .update(updateData)
      .eq('phone_number', phone_number)
      .select('phone_number, email, location, profile_pic, upi_id') // Select only editable fields
      .single();

    if (updateError) {
      console.error('Supabase Update Error:', updateError.message);
      return res.status(500).json({
        success: false,
        error: 'Failed to update profile',
        details: updateError.message,
      });
    }

    // Format response
    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        phone_number: updatedUser.phone_number,
        email: updatedUser.email || '',
        location: updatedUser.location || '',
        profile_pic: updatedUser.profile_pic || null,
        upi_id: updatedUser.upi_id || null,
      },
    });
  } catch (error) {
    console.error('Error updating user profile:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message,
    });
  }
});

// to fetch event_organizer details


app.get('/api/v1/company/profile', async (req, res) => {
  try {
    const { phone_number, email_id } = req.query;
    const trimmedPhoneNumber = phone_number ? phone_number.trim() : null;
    const trimmedEmailId = email_id ? email_id.trim() : null;

    // Validate input
    if (!trimmedPhoneNumber && !trimmedEmailId) {
      return res.status(400).json({
        success: false,
        error: 'Either phone_number or email_id is required',
      });
    }

    // Log the query parameters for debugging
    console.log('Querying with phone_number:', trimmedPhoneNumber, 'email_id:', trimmedEmailId);

    // Fetch company profile from Supabase with additional columns
    const query = supabase
      .from('company_registration')
      .select('company_name, company_address, contact_person_name, phone_number, email_id, account_number, ifsc_code, bank_name, gst_number, company_profile, average_rating');

    const { data, error } = trimmedPhoneNumber
      ? await query.eq('phone_number', trimmedPhoneNumber)
      : await query.eq('email_id', trimmedEmailId);

    if (error) {
      console.error('Supabase Query Error:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Internal server error',
        details: error.message,
      });
    }

    if (!data.length) {
      return res.status(404).json({
        success: false,
        error: 'Company profile not found',
      });
    }

    // Format response
    res.status(200).json({
      success: true,
      message: 'Company profile fetched successfully',
      data: {
        company_name: data[0].company_name || '',
        company_address: data[0].company_address || '',
        contact_person_name: data[0].contact_person_name || '',
        phone_number: data[0].phone_number || '',
        email_id: data[0].email_id || '',
        account_number: data[0].account_number || '',
        ifsc_code: data[0].ifsc_code || '',
        bank_name: data[0].bank_name || '',
        gst_number: data[0].gst_number || '',
        company_profile: data[0].company_profile || null,
        average_rating: data[0].average_rating || null,
      },
    });
  } catch (error) {
    console.error('Error fetching company profile:', error.message, error.stack);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message,
    });
  }
});

app.put('/api/v1/company/profile', async (req, res) => {
  try {
    const {
      phone_number,
      email_id,
      company_name, // Still accepted in req.body but will not be used for update
      company_address,
      contact_person_name,
      account_number,
      ifsc_code,
      bank_name,
      gst_number,
      company_profile, // Allow editing
    } = req.body;

    // Validate input
    if (!phone_number && !email_id) {
      return res.status(400).json({
        success: false,
        error: 'Either phone_number or email_id is required',
      });
    }

    // Check if company exists
    const query = supabase
      .from('company_registration')
      .select('phone_number, email_id')
      .limit(1);

    const { data: existingCompany, error: fetchError } = phone_number
      ? await query.eq('phone_number', phone_number)
      : await query.eq('email_id', email_id);

    if (fetchError || !existingCompany.length) {
      return res.status(404).json({
        success: false,
        error: 'Company not found',
      });
    }

    // Prepare update data (exclude company_name and average_rating)
    const updateData = {};
    if (company_address !== undefined) updateData.company_address = company_address;
    if (contact_person_name !== undefined) updateData.contact_person_name = contact_person_name;
    if (phone_number !== undefined) updateData.phone_number = phone_number;
    if (email_id !== undefined) updateData.email_id = email_id;
    if (account_number !== undefined) updateData.account_number = account_number;
    if (ifsc_code !== undefined) updateData.ifsc_code = ifsc_code;
    if (bank_name !== undefined) updateData.bank_name = bank_name;
    if (gst_number !== undefined) updateData.gst_number = gst_number;
    if (company_profile !== undefined) updateData.company_profile = company_profile; // Allow updating company_profile

    // Ensure updateData is not empty (optional validation)
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No updatable fields provided',
      });
    }

    // Update company profile in Supabase
    const { data: updatedCompany, error: updateError } = await supabase
      .from('company_registration')
      .update(updateData)
      .eq(phone_number ? 'phone_number' : 'email_id', phone_number || email_id)
      .select('company_name, company_address, contact_person_name, phone_number, email_id, account_number, ifsc_code, bank_name, gst_number, company_profile') // Include company_profile
      .single();

    if (updateError) {
      console.error('Supabase Update Error:', updateError.message);
      return res.status(500).json({
        success: false,
        error: 'Failed to update company profile',
        details: updateError.message,
      });
    }

    // Format response
    res.status(200).json({
      success: true,
      message: 'Company profile updated successfully',
      data: {
        company_name: updatedCompany.company_name || '', // Remains unchanged
        company_address: updatedCompany.company_address || '',
        contact_person_name: updatedCompany.contact_person_name || '',
        phone_number: updatedCompany.phone_number || '',
        email_id: updatedCompany.email_id || '',
        account_number: updatedCompany.account_number || '',
        ifsc_code: updatedCompany.ifsc_code || '',
        bank_name: updatedCompany.bank_name || '',
        gst_number: updatedCompany.gst_number || '',
        company_profile: updatedCompany.company_profile || null, // Include updated company_profile
      },
    });
  } catch (error) {
    console.error('Error updating company profile:', error.message, error.stack);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message,
    });
  }
});




app.get('/api/events/filter', async (req, res) => {
  try {
    const { phone_number, dateFrom, dateTo, location, minPay, jobTitle, status } = req.query;

    // Validation
    if (!phone_number && !dateFrom && !dateTo && !location && !minPay && !jobTitle && !status) {
      return res.status(400).json({
        success: false,
        error: 'At least one filter parameter is required',
        code: 'MISSING_FILTER'
      });
    }

    if (minPay && isNaN(parseFloat(minPay))) {
      return res.status(400).json({
        success: false,
        error: 'Minimum pay must be a valid number',
        code: 'INVALID_MIN_PAY'
      });
    }

    // Build base events query
    let supabaseQuery = supabase
      .from('event_create')
      .select('*', { count: 'exact' });

    // Apply filters conditionally
    if (phone_number) {
      supabaseQuery = supabaseQuery.eq('organizer_phone_number', phone_number);
    }
    if (dateFrom) {
      supabaseQuery = supabaseQuery.gte('start_date', dateFrom);
    }
    if (dateTo) {
      supabaseQuery = supabaseQuery.lte('end_date', dateTo);
    }
    if (location) {
      supabaseQuery = supabaseQuery.ilike('location', `%${location}%`);
    }
    if (minPay) {
      supabaseQuery = supabaseQuery.gte('total_pay', parseFloat(minPay));
    }
    if (jobTitle) {
      supabaseQuery = supabaseQuery.ilike('job_title', `%${jobTitle}%`);
    }
    if (status) {
      supabaseQuery = supabaseQuery.eq('status', status);
    }

    // Execute events query
    const { data: events, error: eventsError, count } = await supabaseQuery;

    if (eventsError) {
      console.error('Filter error:', eventsError);
      return res.status(500).json({
        success: false,
        error: 'Failed to filter events',
        code: 'DATABASE_ERROR',
        details: eventsError.message
      });
    }

    // Enrich events with company data and member counts
    const enrichedEvents = await Promise.all(
      events.map(async (event) => {
        // Fetch company details
        const { data: company, error: companyError } = await supabase
          .from('company_registration')
          .select('company_name, contact_person_name, average_rating')
          .eq('phone_number', event.organizer_phone_number)
          .single();

        if (companyError) {
          console.error(`Error fetching company for event ${event.id}:`, companyError);
        }

        // Parse member arrays
        const acceptedMembers = typeof event.accepted_members === 'string'
          ? JSON.parse(event.accepted_members)
          : event.accepted_members || [];

        const appliedMembers = typeof event.applied_members === 'string'
          ? JSON.parse(event.applied_members)
          : event.applied_members || [];

        return {
          ...event,
          total_accepted: acceptedMembers.length,
          total_applied: appliedMembers.length,
          is_completed: new Date(event.end_date) < new Date(),
          company: company
            ? {
                company_name: company.company_name,
                contact_person_name: company.contact_person_name,
                average_rating: company.average_rating || null
              }
            : null
        };
      })
    );

    // Prepare response filters
    const filtersApplied = {
      phone_number: phone_number || null,
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
      location: location || null,
      minPay: minPay ? parseFloat(minPay) : null,
      jobTitle: jobTitle || null,
      status: status || null
    };

    res.status(200).json({
      success: true,
      message: enrichedEvents.length > 0 ? 'Events found' : 'No events found for the specified filters',
      data: {
        events: enrichedEvents || [],
        pagination: {
          totalItems: count || 0
        },
        filtersApplied
      }
    });

  } catch (error) {
    console.error('Unexpected error in events filter:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
      details: error.message
    });
  }
});
app.get('/api/events/organizer/:phone_number', async (req, res) => {
  try {
    const { phone_number } = req.params;

    if (!phone_number) {
      return res.status(400).json({
        success: false,
        error: 'Organizer phone number is required',
      });
    }

    console.log(`Fetching events for organizer: ${phone_number}`);

    // Fetch all events created by the organizer
    const { data: events, error: eventsError } = await supabase
      .from('event_create')
      .select('*, accepted_members, applied_members')
      .eq('organizer_phone_number', phone_number);

    if (eventsError) {
      console.error('Supabase Fetch Error:', eventsError);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch events from the database',
      });
    }

    if (!events || events.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No events found for this organizer',
      });
    }

    // Parse member arrays
    const parsedEvents = events.map(event => ({
      ...event,
      accepted_members: typeof event.accepted_members === 'string'
        ? JSON.parse(event.accepted_members)
        : event.accepted_members || [],
      applied_members: typeof event.applied_members === 'string'
        ? JSON.parse(event.applied_members)
        : event.applied_members || []
    }));

    console.log(`Fetched ${events.length} events for organizer: ${phone_number}`);

    return res.status(200).json({
      success: true,
      message: 'Events fetched successfully',
      events: parsedEvents,
    });

  } catch (error) {
    console.error('Server Error:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// app.get('/api/events/organizer/:phone_number/completed', async (req, res) => {
//   const requestStart = Date.now();
//   const { phone_number } = req.params;
//   const { limit = 10, page = 1 } = req.query;

//   try {
//     // 1. Input Validation
//     if (!phone_number || !/^\+?[\d\s-]{10,}$/.test(phone_number)) {
//       return res.status(400).json({
//         success: false,
//         error: 'Valid phone number is required',
//         code: 'INVALID_PHONE'
//       });
//     }

//     // 2. Calculate pagination
//     const pageSize = parseInt(limit);
//     const offset = (parseInt(page) - 1) * pageSize;

//     // 3. Get current datetime
//     const currentDateTime = new Date();
//     const currentDate = currentDateTime.toISOString().split('T')[0];
//     const currentTime = currentDateTime.toTimeString().split(' ')[0];

//     // 4. Database Query
//     const { data: events, error, count } = await supabase
//       .from('event_create')
//       .select(`
//         id,
//         event_name,
//         poster_file,
//         start_date,
//         end_date,
//         start_time,
//         end_time,
//         location,
//         job_title,
//         status,
//         created_at,
//         accepted_members,
//         applied_members,
//         male_crew_pay,
//         female_crew_pay,
//         total_pay,
//         additional_details
//       `, { count: 'exact' })
//       .eq('organizer_phone_number', phone_number)
//       .lte('end_date', currentDate) // Ensure event has ended
//       .order('end_date', { ascending: false })
//       .order('end_time', { ascending: false })
//       .range(offset, offset + pageSize - 1);

//     if (error) {
//       console.error('Database Error:', error);
//       return res.status(500).json({
//         success: false,
//         error: 'Failed to fetch completed events',
//         code: 'DATABASE_ERROR',
//         details: error.message
//       });
//     }

//     // Safe JSON parser
//     const safeParseJson = (str) => {
//       try {
//         return typeof str === 'string' ? JSON.parse(str) : str;
//       } catch {
//         return [];
//       }
//     };

//     // 5. Process events (filter only completed events)
//     const processedEvents = (events || []).filter(event => {
//       const endDateOnly = event.end_date.split('T')[0];
//       const eventEndTime = event.end_time
//         ? (event.end_time.length === 5 ? `${event.end_time}:00` : event.end_time)
//         : '00:00:00';
//       return new Date(`${endDateOnly}T${eventEndTime}`) < currentDateTime;
//     }).map(event => {
//       const endDateOnly = event.end_date.split('T')[0];
//       const eventEndTime = event.end_time
//         ? (event.end_time.length === 5 ? `${event.end_time}:00` : event.end_time)
//         : '00:00:00';
//       const eventEndDateTime = new Date(`${endDateOnly}T${eventEndTime}`);
//       const isCompleted = eventEndDateTime < currentDateTime;

//       let appliedMembersIds = safeParseJson(event.applied_members) || [];
//       if (!Array.isArray(appliedMembersIds)) {
//         appliedMembersIds = appliedMembersIds ? [appliedMembersIds] : [];
//       }

//       return {
//         ...event,
//         accepted_members: safeParseJson(event.accepted_members) || [],
//         applied_members: appliedMembersIds,
//         total_accepted: (safeParseJson(event.accepted_members) || []).length,
//         total_applied: appliedMembersIds.length,
//         is_completed: isCompleted,
//         completion_time: `${endDateOnly}T${eventEndTime}`
//       };
//     });

//     // 6. Success Response
//     res.status(200).json({
//       success: true,
//       message: 'Completed events fetched successfully',
//       count: processedEvents.length,
//       total_events: count || 0,
//       current_page: parseInt(page),
//       total_pages: Math.ceil((count || 0) / pageSize),
//       events: processedEvents,
//       processing_time: `${Date.now() - requestStart}ms`,
//       current_datetime: currentDateTime.toISOString(),
//       query_conditions: {
//         end_date_past_or_today: currentDate,
//         end_time_past: currentTime
//       }
//     });

//   } catch (error) {
//     console.error('Server Error:', error);
//     res.status(500).json({
//       success: false,
//       error: 'Internal server error',
//       code: 'SERVER_ERROR',
//       details: error.message
//     });
//   }
// });





app.get('/api/events/organizer/:phone_number/completed', async (req, res) => {
  const requestStart = Date.now();
  const { phone_number } = req.params;
  const { limit = 10, page = 1 } = req.query;

  try {
    // 1. Input Validation
    if (!phone_number || !/^\+?[\d\s-]{10,}$/.test(phone_number)) {
      return res.status(400).json({
        success: false,
        error: 'Valid phone number is required',
        code: 'INVALID_PHONE'
      });
    }

    // 2. Calculate pagination
    const pageSize = parseInt(limit);
    const offset = (parseInt(page) - 1) * pageSize;

    // 3. Get current datetime
    const currentDateTime = new Date();
    const currentDate = currentDateTime.toISOString().split('T')[0];
    const currentTime = currentDateTime.toTimeString().split(' ')[0];

    // 4. Database Query
    const { data: events, error, count } = await supabase
      .from('event_create')
      .select(`
        id,
        event_name,
        poster_file,
        start_date,
        end_date,
        start_time,
        end_time,
        location,
        job_title,
        status,
        created_at,
        accepted_members,
        applied_members,
        male_crew_pay,
        female_crew_pay,
        total_pay,
        additional_details
      `, { count: 'exact' })
      .eq('organizer_phone_number', phone_number)
      .lte('end_date', currentDate)
      .order('end_date', { ascending: false })
      .order('end_time', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error('Database Error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch completed events',
        code: 'DATABASE_ERROR',
        details: error.message
      });
    }

    // 5. Process events (only completed events)
    const processedEvents = (events || []).filter(event => {
      const endDateOnly = event.end_date.split('T')[0];
      const eventEndTime = event.end_time ? (event.end_time.length === 5 ? `${event.end_time}:00` : event.end_time) : '00:00:00';
      return new Date(`${endDateOnly}T${eventEndTime}`) < currentDateTime;
    }).map(event => {
      const endDateOnly = event.end_date.split('T')[0];
      const eventEndTime = event.end_time ? (event.end_time.length === 5 ? `${event.end_time}:00` : event.end_time) : '00:00:00';
      const eventEndDateTime = new Date(`${endDateOnly}T${eventEndTime}`);
      const isCompleted = eventEndDateTime < currentDateTime;

      // Parse applied_members
      let appliedMembersIds = safeParseJson(event.applied_members) || [];
      if (!Array.isArray(appliedMembersIds)) {
        appliedMembersIds = appliedMembersIds ? [appliedMembersIds] : [];
      }

      return {
        poster_file: event.poster_file, // 👈 explicitly placed first
        ...event,
        accepted_members: safeParseJson(event.accepted_members) || [],
        applied_members: appliedMembersIds,
        total_accepted: (safeParseJson(event.accepted_members) || []).length,
        total_applied: appliedMembersIds.length,
        is_completed: isCompleted,
        completion_time: `${endDateOnly}T${eventEndTime}`
      };
    });

    // 6. Success Response
    res.status(200).json({
      success: true,
      message: 'Completed events fetched successfully',
      count: processedEvents.length,
      total_events: count || 0,
      current_page: parseInt(page),
      total_pages: Math.ceil((count || 0) / pageSize),
      events: processedEvents,
      processing_time: `${Date.now() - requestStart}ms`,
      current_datetime: currentDateTime.toISOString(),
      query_conditions: {
        end_date_past_or_today: currentDate,
        end_time_past: currentTime
      }
    });

  } catch (error) {
    console.error('Server Error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'SERVER_ERROR',
      details: error.message
    });
  }
});


app.get('/api/events/:event_id/accepted-members/rating', async (req, res) => {
  const requestStart = Date.now();
  const { event_id } = req.params;

  try {
    // 1. Input Validation
    if (!event_id) {
      return res.status(400).json({
        success: false,
        error: 'Event ID is required',
        code: 'INVALID_EVENT_ID'
      });
    }

    // 2. Fetch event details to get accepted_members
    const { data: event, error: eventError } = await supabase
      .from('event_create')
      .select('accepted_members')
      .eq('id', event_id)
      .single();

    if (eventError) {
      console.error('Event Fetch Error:', eventError);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch event details',
        code: 'DATABASE_ERROR',
        details: eventError.message
      });
    }

    if (!event) {
      return res.status(404).json({
        success: false,
        error: 'Event not found',
        code: 'EVENT_NOT_FOUND'
      });
    }

    // 3. Parse accepted_members
    let acceptedMembersIds = safeParseJson(event.accepted_members) || [];
    if (!Array.isArray(acceptedMembersIds)) {
      acceptedMembersIds = acceptedMembersIds ? [acceptedMembersIds] : [];
    }

    if (acceptedMembersIds.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No accepted members for this event',
        data: {
          total_accepted: 0,
          male_count: 0,
          female_count: 0,
          male_members: [],
          female_members: []
        },
        processing_time: `${Date.now() - requestStart}ms`
      });
    }

    // 4. Fetch accepted members details including gender, average_rating, and rating_count
    const { data: members, error: membersError } = await supabase
      .from('user1')
      .select('id, phone_number, first_name, last_name, gender, average_rating, rating_count') // Added average_rating and rating_count
      .in('phone_number', acceptedMembersIds);

    if (membersError) {
      console.error('Members Fetch Error:', membersError);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch accepted members details',
        code: 'DATABASE_ERROR',
        details: membersError.message
      });
    }

    // 5. Separate members by gender and count
    const maleMembers = members.filter(member => 
      member.gender === 'male' || member.gender === 'Male' || member.gender === 'M'
    );
    const femaleMembers = members.filter(member => 
      member.gender === 'female' || member.gender === 'Female' || member.gender === 'F'
    );

    // 6. Success Response
    res.status(200).json({
      success: true,
      message: 'Accepted members fetched successfully',
      data: {
        total_accepted: members.length,
        male_count: maleMembers.length,
        female_count: femaleMembers.length,
        male_members: maleMembers,
        female_members: femaleMembers
      },
      processing_time: `${Date.now() - requestStart}ms`
    });

  } catch (error) {
    console.error('Server Error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'SERVER_ERROR',
      details: error.message
    });
  }
});

function safeParseJson(jsonString) {
  try {
    if (typeof jsonString === 'string') {
      return JSON.parse(jsonString);
    }
    return jsonString; // Return as-is if not a string
  } catch (e) {
    console.error('Error parsing JSON:', e);
    return null;
  }
}

// Helper function to safely parse JSON arrays
function safeParseJson(jsonString) {
  try {
    if (typeof jsonString === 'string') {
      return JSON.parse(jsonString);
    }
    return jsonString; // Return as-is if not a string
  } catch (e) {
    console.error('Error parsing JSON:', e);
    return null;
  }
}

// Helper function to safely parse JSON arrays
function safeParseJson(jsonString) {
  try {
    if (typeof jsonString === 'string') {
      return JSON.parse(jsonString);
    }
    return jsonString; // Return as-is if not a string
  } catch (e) {
    console.error('Error parsing JSON:', e);
    return null;
  }
}

// Helper function to safely parse JSON arrays
function safeParseJson(jsonString) {
  try {
    if (typeof jsonString === 'string') {
      return JSON.parse(jsonString);
    }
    return jsonString; // Return as-is if not a string
  } catch (e) {
    console.error('Error parsing JSON:', e);
    return null;
  }
}

// Helper function to safely parse JSON arrays
function safeParseJson(jsonString) {
  try {
    if (typeof jsonString === 'string') {
      return JSON.parse(jsonString);
    }
    return jsonString; // Return as-is if not a string
  } catch (e) {
    console.error('Error parsing JSON:', e);
    return null;
  }
}


app.get('/api/user/completed-events/:phone_number', async (req, res) => {
  try {
    const { phone_number } = req.params;

    // 1. Validate input
    if (!phone_number || typeof phone_number !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Valid phone number is required',
      });
    }

    // 2. Fetch worker's details including average_rating and rating_count
    const { data: worker, error: workerError } = await supabase
      .from('user1')
      .select('phone_number, average_rating, rating_count')
      .eq('phone_number', phone_number.trim())
      .single();

    if (workerError) {
      console.error('Supabase Worker Fetch Error:', workerError);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch worker details',
      });
    }

    if (!worker) {
      return res.status(404).json({
        success: false,
        error: 'Worker not found',
      });
    }

    // 3. Fetch all events where the worker was accepted and status is 'completed'
    const { data: acceptedEvents, error: fetchError } = await supabase
      .from('event_create')
      .select('*')
      .contains('accepted_members', [phone_number.trim()])
      .eq('status', 'completed'); // ✅ Only fetch completed events

    if (fetchError) {
      console.error('Supabase Fetch Error:', fetchError);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch accepted events',
      });
    }

    if (!acceptedEvents || acceptedEvents.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No completed events found for this worker',
        data: [],
        worker_average_rating: worker.average_rating || null,
        worker_rating_count: worker.rating_count || 0,
        total: 0
      });
    }

    // 4. (Optional) Sort completed events by end_date descending
    const completedEvents = acceptedEvents.sort(
      (a, b) => new Date(b.end_date) - new Date(a.end_date)
    );

    // 5. Enrich event data with organizer details
    const enrichedEvents = await Promise.all(
      completedEvents.map(async (event) => {
        const { data: organizer, error: orgError } = await supabase
          .from('company_registration')
          .select('company_name, contact_person_name, average_rating')
          .eq('phone_number', event.organizer_phone_number)
          .single();

        if (orgError) {
          console.error(`Error fetching organizer for event ${event.id}:`, orgError);
        }

        return {
          event_id: event.id,
          event_name: event.event_name,
          poster_file: event.poster_file,
          start_date: event.start_date,
          end_date: event.end_date,
          location: event.location,
          job_title: event.job_title,
          total_pay: event.total_pay,
          organizer: organizer
            ? {
                company_name: organizer.company_name,
                contact_person_name: organizer.contact_person_name,
                average_rating: organizer.average_rating || null,
                phone_number: event.organizer_phone_number,
              }
            : {
                company_name: 'Unavailable',
                contact_person_name: 'Unavailable',
                average_rating: null,
                phone_number: event.organizer_phone_number,
              },
        };
      })
    );

    // 6. Return the response
    res.status(200).json({
      success: true,
      message: 'Completed events fetched successfully',
      data: enrichedEvents,
      worker_average_rating: worker.average_rating || null,
      worker_rating_count: worker.rating_count || 0,
      total: enrichedEvents.length,
    });

  } catch (error) {
    console.error('Error fetching completed events:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
});


// Endpoint: Register phone number
app.post('/api/v1/company/register', async (req, res) => {
  try {
    const {
      company_name,
      company_address,
      contact_person_name,
      phone_number,
      email_id,
      account_number,
      ifsc_code,
      bank_name,
      gst_number,
      company_profile, // Will accept Base64 data
    } = req.body;

    // Check if all required fields are provided
    if (!company_name || !company_address || !contact_person_name || !phone_number || !email_id || !account_number || !ifsc_code || !bank_name || !gst_number) {
      return res.status(400).json({
        success: false,
        error: 'All fields except company_profile are required.',
      });
    }

    // Handle company_profile upload if provided as Base64
    let companyProfileUrl = company_profile;
    if (company_profile && company_profile.startsWith('data:image')) {
      companyProfileUrl = await uploadBase64ToSupabase(
        company_profile,
        'company_profiles', // Bucket name for company profiles
        `profile_${phone_number}_${Date.now()}.jpg` // Unique filename
      );
      if (!companyProfileUrl) {
        return res.status(500).json({
          success: false,
          error: 'Failed to upload company profile image',
        });
      }
    }

    // Insert data into Supabase
    const { data, error } = await supabase
      .from('company_registration')
      .insert([
        {
          company_name,
          company_address,
          contact_person_name,
          phone_number,
          email_id,
          account_number,
          ifsc_code,
          bank_name,
          gst_number,
          company_profile: companyProfileUrl, // Store the URL or null if no upload
        }
      ])
      .select('*'); // To return the inserted row

    if (error) {
      console.error('Supabase Insert Error:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Failed to register company',
      });
    }

    res.status(201).json({
      success: true,
      message: 'Company registered successfully',
      company: data[0],
    });
  } catch (error) {
    console.error('Error registering company:', error.message);
    res.status(500).json({
      success: false,
      error: 'Server error occurred',
    });
  }
});



// Create deleted_numbers table if it doesn't exist
async function initializeDeletedNumbersTable() {
  const queryFn = () => supabase.from('deleted_numbers').select('*').limit(1);
  const { error } = await queryWithRetry(queryFn);

  if (error && error.code === '42P01') { // Table doesn't exist
    const createTableQuery = `
      CREATE TABLE deleted_numbers (
        id SERIAL PRIMARY KEY,
        phone_number TEXT NOT NULL,
        deleted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;
    const { error: createError } = await supabase.rpc('execute_sql', { sql: createTableQuery });
    if (createError) {
      console.error(`[${new Date().toISOString()}] Failed to create deleted_numbers table:`, createError.message);
      throw createError;
    }
    console.log(`[${new Date().toISOString()}] deleted_numbers table created successfully`);
  }
}

// POST API to delete user/organizer account from event_create and user1 tables only

app.post('/api/delete-account', async (req, res) => {
  const { phone_number } = req.body;

  if (!phone_number) {
    return res.status(400).json({ success: false, error: 'Phone number is required' });
  }

  // Validate phone_number format
  const phoneRegex = /^\+?[1-9]\d{1,14}$/;
  if (!phoneRegex.test(phone_number)) {
    return res.status(400).json({ success: false, error: 'Invalid phone_number format. Must be a valid phone number with optional country code.' });
  }

  try {
    // Initialize deleted_numbers table
    await initializeDeletedNumbersTable();

    // Check if phone number exists in user1 table
    const userQuery = () => supabase
      .from('user1')
      .select('id')
      .eq('phone_number', phone_number);
    const { data: userData, error: userError } = await queryWithRetry(userQuery);

    if (userError) {
      console.error(`[${new Date().toISOString()}] Error checking user1 table:`, userError.message);
      return res.status(500).json({ success: false, error: 'Error checking phone number in user1 table' });
    }

    // Check if phone number exists in event_create table as organizer
    const eventQuery = () => supabase
      .from('event_create')
      .select('id')
      .eq('organizer_phone_number', phone_number);
    const { data: eventData, error: eventError } = await queryWithRetry(eventQuery);

    if (eventError) {
      console.error(`[${new Date().toISOString()}] Error checking event_create table:`, eventError.message);
      return res.status(500).json({ success: false, error: 'Error checking phone number in event_create table' });
    }

    // If phone number is found in user1, delete from user1 table
    if (userData && userData.length > 0) {
      const userId = userData[0].id;
      const deleteUserQuery = () => supabase.from('user1').delete().eq('id', userId);
      const { error: deleteUserError } = await queryWithRetry(deleteUserQuery);

      if (deleteUserError) {
        console.error(`[${new Date().toISOString()}] Error deleting from user1 table:`, deleteUserError.message);
        return res.status(500).json({ success: false, error: 'Error deleting from user1 table' });
      }
    }

    // If phone number is found in event_create, delete related records first
    if (eventData && eventData.length > 0) {
      const eventIds = eventData.map(event => event.id);

      // Delete related records from event_applications
      const deleteApplicationsQuery = () => supabase
        .from('event_applications')
        .delete()
        .in('event_id', eventIds);
      const { error: deleteApplicationsError } = await queryWithRetry(deleteApplicationsQuery);

      if (deleteApplicationsError) {
        console.error(`[${new Date().toISOString()}] Error deleting from event_applications table:`, deleteApplicationsError.message);
        return res.status(500).json({ success: false, error: 'Error deleting from event_applications table' });
      }

      // Delete related records from chat_rooms
      const deleteChatRoomsQuery = () => supabase
        .from('chat_rooms')
        .delete()
        .in('event_id', eventIds);
      const { error: deleteChatRoomsError } = await queryWithRetry(deleteChatRoomsQuery);

      if (deleteChatRoomsError) {
        console.error(`[${new Date().toISOString()}] Error deleting from chat_rooms table:`, deleteChatRoomsError.message);
        return res.status(500).json({ success: false, error: 'Error deleting from chat_rooms table' });
      }

      // 🔥 Delete related records from ratings
      const deleteRatingsQuery = () => supabase
        .from('ratings')
        .delete()
        .in('event_id', eventIds);
      const { error: deleteRatingsError } = await queryWithRetry(deleteRatingsQuery);

      if (deleteRatingsError) {
        console.error(`[${new Date().toISOString()}] Error deleting from ratings table:`, deleteRatingsError.message);
        return res.status(500).json({ success: false, error: 'Error deleting from ratings table' });
      }

      // Now delete from event_create
      const deleteEventQuery = () => supabase
        .from('event_create')
        .delete()
        .eq('organizer_phone_number', phone_number);
      const { error: deleteEventError } = await queryWithRetry(deleteEventQuery);

      if (deleteEventError) {
        console.error(`[${new Date().toISOString()}] Error deleting from event_create table:`, deleteEventError.message);
        return res.status(500).json({ success: false, error: 'Error deleting from event_create table' });
      }
    }

    // If phone number exists in company_registration, delete it
    const deleteCompanyQuery = () => supabase
      .from('company_registration')
      .delete()
      .eq('phone_number', phone_number);
    const { error: deleteCompanyError } = await queryWithRetry(deleteCompanyQuery);

    if (deleteCompanyError) {
      console.error(`[${new Date().toISOString()}] Error deleting from company_registration table:`, deleteCompanyError.message);
      return res.status(500).json({ success: false, error: 'Error deleting from company_registration table' });
    }

    // 🔥 Delete files from storage buckets
    const buckets = ['uploads', 'event_uploads', 'profile_pics', 'aadhar_files'];

    for (const bucket of buckets) {
      try {
        // List files in each bucket that match phone_number (if you prefix them by phone, or store mapping)
        const { data: files, error: listError } = await supabase
          .storage
          .from(bucket)
          .list('', { search: phone_number });  // adjust if you keep folders/prefixes

        if (listError) {
          console.error(`[${new Date().toISOString()}] Error listing files in bucket ${bucket}:`, listError.message);
          continue; // skip this bucket
        }

        if (files && files.length > 0) {
          const fileNames = files.map(file => file.name);

          const { error: deleteError } = await supabase
            .storage
            .from(bucket)
            .remove(fileNames);

          if (deleteError) {
            console.error(`[${new Date().toISOString()}] Error deleting files in bucket ${bucket}:`, deleteError.message);
          } else {
            console.log(`[${new Date().toISOString()}] Deleted files from bucket ${bucket}:`, fileNames);
          }
        }
      } catch (err) {
        console.error(`[${new Date().toISOString()}] Exception deleting from bucket ${bucket}:`, err.message);
      }
    }

    // Log the deleted phone number
    const logQuery = () => supabase
      .from('deleted_numbers')
      .insert({ phone_number });
    const { error: logError } = await queryWithRetry(logQuery);

    if (logError) {
      console.error(`[${new Date().toISOString()}] Error logging deleted phone number:`, logError.message);
      return res.status(500).json({ success: false, error: 'Error logging deleted phone number' });
    }

    return res.status(200).json({ success: true, message: 'Account deleted successfully from user1, event_create, company_registration, and storage' });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Server error in /api/delete-account:`, error.message);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});





app.get('/api/v1/user/organizer/details', async (req, res) => {
    try {
      const { phone_number } = req.query;
  
      // Validate input
      if (!phone_number) {
        return res.status(400).json({
          success: false,
          error: "Phone number is required"
        });
      }
  
      // 1. Get ALL company details (excluding sensitive fields)
      const { data: company, error: companyError } = await supabase
        .from('company_registration')
        .select('*') // Select all columns
        .eq('phone_number', phone_number)
        .single();
  
      if (companyError || !company) {
        return res.status(404).json({
          success: false,
          error: "Company not registered with this phone number"
        });
      }
  
      // 2. Optional: Get user profile data
      const { data: user } = await supabase
        .from('user1')
        .select('user_type, profile_pic')
        .eq('phone_number', phone_number)
        .single();
  
      // 3. Prepare response (customize excluded fields as needed)
      const { password_hash, reset_token, ...safeCompanyData } = company;
      
      res.status(200).json({
        success: true,
        data: {
          ...safeCompanyData,
          user_type: user?.user_type || "Organizer",
          profile_pic: user?.profile_pic || null
        }
      });
  
    } catch (error) {
      console.error("Error fetching organizer details:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error"
      });
    }
  });
 app.put('/api/v1/user/:phone_number/update-details', async (req, res) => {
    try {
      const { phone_number } = req.params;
      const { profile_pic, aadhar_file, ...otherData } = req.body;
  
      // Validate input
      if (!phone_number) {
        return res.status(400).json({
          success: false,
          error: "Phone number is required"
        });
      }
  
      // Process profile_pic (accepts URL or Base64)
      let profilePicUrl = profile_pic;
      if (profile_pic && profile_pic.startsWith('data:image')) {
        profilePicUrl = await uploadBase64ToSupabase(
          profile_pic, 
          'profile_pics',
          `profile_${phone_number}_${Date.now()}.jpg`
        );
      }
  
      // Process aadhar_file (accepts URL or Base64)
      let aadharFileUrl = aadhar_file;
      if (aadhar_file && aadhar_file.startsWith('data:application')) {
        aadharFileUrl = await uploadBase64ToSupabase(
          aadhar_file,
          'aadhar_files',
          `aadhar_${phone_number}_${Date.now()}.pdf`
        );
      }
  
      // Update user in Supabase
      const { data, error } = await supabase
        .from('user1')
        .update({
          ...otherData,
          ...(profilePicUrl && { profile_pic: profilePicUrl }),
          ...(aadharFileUrl && { aadhar_file: aadharFileUrl })
        })
        .eq('phone_number', phone_number)
        .select();
  
      if (error) throw error;
  
      res.status(200).json({
        success: true,
        message: "User details updated successfully",
        data: data[0]
      });
  
    } catch (error) {
      console.error("Update error:", error.message);
      res.status(500).json({
        success: false,
        error: error.message || "Update failed"
      });
    }
  });

app.get('/api/user/applied-events/:phone_number/:event_id', async (req, res) => {
  try {
    const { phone_number, event_id } = req.params;

    // Input validation
    if (!phone_number || typeof phone_number !== 'string' || phone_number.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Valid phone number is required',
      });
    }

    if (!event_id || typeof event_id !== 'string' || event_id.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Valid event ID is required',
      });
    }

    console.log(`Fetching applied event ${event_id} for phone number: ${phone_number}`);

    // Step 1: Fetch application for this user and event_id
    const { data: applications, error: applicationsError } = await supabase
      .from('event_applications')
      .select(`
        event_id,
        applied_at,
        images,
        event_create (
          id,
          event_name,
          poster_file,
          start_date,
          end_date,
          location,
          job_title,
          job_specifications,
          dress_code,
          food_provided,
          transport_provided,
          male_crew_pay,
          female_crew_pay,
          total_pay,
          additional_details,
          organizer_phone_number,
          applied_members,
          accepted_members,
          start_time,
          end_time,
          male_crew_pay,
          female_crew_pay
        )
      `)
      .eq('phone_number', phone_number.trim())
      .eq('event_id', event_id);

    if (applicationsError) {
      console.error('Supabase Fetch Error (event_applications):', applicationsError);
      return res.status(500).json({
        success: false,
        error: `Failed to fetch application: ${applicationsError.message}`,
      });
    }

    // ✅ If no application exists, return placeholder with status: "not_applied"
    if (!applications || applications.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No events applied for by this user',
        data: [
          {
            event_id: event_id,
            status: 'not_applied'
          }
        ],
      });
    }

    // Step 2: Format the response
    const appliedEvents = applications
      .filter(app => app.event_create)
      .map(app => {
        const { event_create, applied_at, images } = app;
        const {
          applied_members = [],
          accepted_members = [],
          ...eventDetails
        } = event_create;

        const isApplied = applied_members.includes(phone_number) || accepted_members.includes(phone_number);
        const isAccepted = accepted_members.includes(phone_number);
        let status = 'not_applied';
        if (isAccepted) {
          status = 'accepted';
        } else if (isApplied) {
          status = 'applied';
        }

        return {
          event_id: eventDetails.id,
          event_name: eventDetails.event_name,
          poster_file: eventDetails.poster_file,
          start_date: eventDetails.start_date,
          end_date: eventDetails.end_date,
          start_time: eventDetails.start_time,
          end_time: eventDetails.end_time,
          location: eventDetails.location,
          job_title: eventDetails.job_title,
          job_specifications: eventDetails.job_specifications,
          dress_code: eventDetails.dress_code,
          food_provided: eventDetails.food_provided,
          transport_provided: eventDetails.transport_provided,
          male_crew_pay: eventDetails.male_crew_pay,
          female_crew_pay: eventDetails.female_crew_pay,
          total_pay: eventDetails.total_pay,
          additional_details: eventDetails.additional_details,
          organizer_phone_number: eventDetails.organizer_phone_number,
          applied_at,
          images,
          status,
          is_applied: isApplied,
          is_accepted: isAccepted,
        };
      });

    // Step 3: Return
    res.status(200).json({
      success: true,
      message: 'Applied event fetched successfully',
      data: appliedEvents,
      total: appliedEvents.length,
    });
  } catch (error) {
    console.error('Error fetching applied event:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
});


app.get('/api/user/applied-events/:phone_number', async (req, res) => {
  try {
    const { phone_number } = req.params;

    // Input validation
    if (!phone_number || typeof phone_number !== 'string' || phone_number.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Valid phone number is required',
      });
    }

    console.log(`Fetching applied events for phone number: ${phone_number}`);

    // Fetch applications with joined event details
    const { data: applications, error: applicationsError } = await supabase
      .from('event_applications')
      .select(`
        event_id,
        applied_at,
        images,
        event_create (
          id,
          event_name,
          poster_file,
          start_date,
          end_date,
          start_time,
          end_time,
          location,
          job_title,
          job_specifications,
          dress_code,
          food_provided,
          transport_provided,
          male_crew_pay,
          female_crew_pay,
          total_pay,
          additional_details,
          organizer_phone_number,
          applied_members,
          accepted_members
        )
      `)
      .eq('phone_number', phone_number.trim());

    if (applicationsError) {
      console.error('Supabase Fetch Error (event_applications):', applicationsError);
      return res.status(500).json({
        success: false,
        error: `Failed to fetch applications: ${applicationsError.message}`,
      });
    }

    if (!applications || applications.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No events applied for by this user',
        data: [],
      });
    }

    // Parse safely
    const safeParse = (data) => {
      try {
        return typeof data === 'string' ? JSON.parse(data) : (data || []);
      } catch {
        return [];
      }
    };

    // Format response
    const appliedEvents = applications
      .filter(app => app.event_create)
      .map(app => {
        const { event_create, applied_at, images } = app;
        const appliedMembers = safeParse(event_create.applied_members);
        const acceptedMembers = safeParse(event_create.accepted_members);

        const isApplied = appliedMembers.includes(phone_number);
        const isAccepted = acceptedMembers.includes(phone_number);

        let status = 'not_applied';
        if (isAccepted) {
          status = 'accepted';
        } else if (isApplied) {
          status = 'applied';
        }

        return {
          event_id: event_create.id,
          event_name: event_create.event_name,
          poster_file: event_create.poster_file,
          start_date: event_create.start_date,
          end_date: event_create.end_date,
          start_time: event_create.start_time,
          end_time: event_create.end_time,
          location: event_create.location,
          job_title: event_create.job_title,
          job_specifications: event_create.job_specifications,
          dress_code: event_create.dress_code,
          food_provided: event_create.food_provided,
          transport_provided: event_create.transport_provided,
          male_crew_pay: event_create.male_crew_pay,
          female_crew_pay: event_create.female_crew_pay,
          total_pay: event_create.total_pay,
          additional_details: event_create.additional_details,
          organizer_phone_number: event_create.organizer_phone_number,
          applied_at,
          images,
          status,
          is_applied: isApplied,
          is_accepted: isAccepted,
        };
      });

    res.status(200).json({
      success: true,
      message: 'Applied events fetched successfully',
      data: appliedEvents,
      total: appliedEvents.length,
    });

  } catch (error) {
    console.error('Error fetching applied events:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
});

app.get('/api/user/events-status/:phone_number', async (req, res) => {
  try {
    const { phone_number } = req.params;

    // Input validation
    if (!phone_number || typeof phone_number !== 'string' || phone_number.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Valid phone number is required',
      });
    }

    const trimmedPhoneNumber = phone_number.trim();
    console.log(`Fetching events status for phone_number: ${trimmedPhoneNumber}`);

    // Step 1: Fetch applied events from event_applications
    const { data: appliedEvents, error: appliedError } = await supabase
      .from('event_applications')
      .select(`
        event_id,
        applied_at,
        event_create (
          id,
          event_name,
          poster_file,
          start_date,
          end_date,
          location,
          job_title,
          job_specifications,
          dress_code,
          food_provided,
          transport_provided,
          male_crew_pay,
          female_crew_pay,
          total_pay,
          additional_details,
          organizer_phone_number,
          saved,
          applied_members,
          accepted_members
        )
      `)
      .eq('phone_number', trimmedPhoneNumber);

    if (appliedError) {
      console.error('Supabase Fetch Error (applied events):', appliedError);
      throw appliedError;
    }

    // Step 2: Fetch saved events from event_create where phone_number is in saved array
    const { data: savedEvents, error: savedError } = await supabase
      .from('event_create')
      .select(`
        id,
        event_name,
        poster_file,
        start_date,
        end_date,
        location,
        job_title,
        job_specifications,
        dress_code,
        food_provided,
        transport_provided,
        male_crew_pay,
        female_crew_pay,
        total_pay,
        additional_details,
        organizer_phone_number,
        saved,
        applied_members,
        accepted_members
      `)
      .contains('saved', JSON.stringify([trimmedPhoneNumber]));

    if (savedError) {
      console.error('Supabase Fetch Error (saved events):', savedError);
      throw savedError;
    }

    // Step 3: Combine and process events
    const eventMap = new Map();

    // Process applied events
    if (appliedEvents && appliedEvents.length > 0) {
      appliedEvents.forEach(app => {
        if (app.event_create) {
          const eventData = app.event_create;
          let status = 'Saved'; // Default
          if (eventData.accepted_members?.includes(trimmedPhoneNumber)) {
            status = 'Accepted';
          } else if (eventData.applied_members?.includes(trimmedPhoneNumber)) {
            status = 'Applied';
          }

          eventMap.set(eventData.id, {
            ...eventData,
            status,
            applied_at: app.applied_at || null
          });
        }
      });
    }

    // Process saved events, only add if not already applied or accepted
    if (savedEvents && savedEvents.length > 0) {
      savedEvents.forEach(event => {
        if (!eventMap.has(event.id)) {
          let status = 'Saved';
          if (event.accepted_members?.includes(trimmedPhoneNumber)) {
            status = 'Accepted';
          } else if (event.applied_members?.includes(trimmedPhoneNumber)) {
            status = 'Applied';
          }

          eventMap.set(event.id, {
            ...event,
            status,
            applied_at: null
          });
        }
      });
    }

    const combinedEvents = Array.from(eventMap.values()).map(event => ({
      id: event.id,
      event_name: event.event_name,
      poster_file: event.poster_file,
      start_date: event.start_date,
      end_date: event.end_date,
      location: event.location,
      job_title: event.job_title,
      job_specifications: event.job_specifications,
      dress_code: event.dress_code,
      food_provided: event.food_provided,
      transport_provided: event.transport_provided,
      male_crew_pay: event.male_crew_pay,
      female_crew_pay: event.female_crew_pay,
      total_pay: event.total_pay,
      additional_details: event.additional_details,
      organizer_phone_number: event.organizer_phone_number,
      status: event.status,
      applied_at: event.applied_at
    }));

    // Step 4: Return response
    if (combinedEvents.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No applied or saved events found for this user',
        data: [],
        total: 0
      });
    }

    res.status(200).json({
      success: true,
      message: 'Events fetched successfully',
      data: combinedEvents,
      total: combinedEvents.length
    });

  } catch (error) {
    console.error('Error fetching events status:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});



app.put('/api/events/:event_id/applications/:phone_number/status', async (req, res) => {
  try {
    const { event_id, phone_number } = req.params;
    const { status } = req.body;

    console.log(`[${new Date().toISOString()}] Request Params:`, { event_id, phone_number });
    console.log(`[${new Date().toISOString()}] Request Body:`, { status });

    // Validate status
    if (status !== 'accepted') { 
      return res.status(400).json({
        success: false,
        error: "Invalid status. Must be 'accepted'.",
        code: 'INVALID_STATUS',
      });
    }

    // Step 1: Fetch the event details including male_crew and female_crew
    const { data: event, error: fetchError } = await supabase
      .from('event_create')
      .select('event_name, accepted_members, applied_members, male_crew, female_crew')
      .eq('id', event_id)
      .single();

    if (fetchError) {
      console.error(`[${new Date().toISOString()}] Supabase Fetch Error (event_create):`, JSON.stringify(fetchError, null, 2));
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch event details.',
        code: 'DATABASE_ERROR',
      });
    }

    if (!event) {
      return res.status(404).json({
        success: false,
        error: 'Event not found.',
        code: 'EVENT_NOT_FOUND',
      });
    }

    // Initialize arrays if undefined
    let acceptedMembers = event.accepted_members || [];
    let appliedMembers = event.applied_members || [];

    // Remove from applied_members
    appliedMembers = appliedMembers.filter(member => member !== phone_number);

    // Add to accepted_members if not already there
    if (!acceptedMembers.includes(phone_number)) {
      acceptedMembers.push(phone_number);
    }

    // Calculate total crew slots
    const totalCrewSlots = (event.male_crew || 0) + (event.female_crew || 0);
    const acceptedMembersCount = acceptedMembers.length;

    // Update status_to_pay if accepted_members count equals total crew slots
    const statusToPay = acceptedMembersCount === totalCrewSlots;

    // Step 2: Update the table
    const { error: updateError } = await supabase
      .from('event_create')
      .update({
        accepted_members: acceptedMembers,
        applied_members: appliedMembers,
        status_to_pay: statusToPay
      })
      .eq('id', event_id);

    if (updateError) {
      console.error(`[${new Date().toISOString()}] Supabase Update Error (event_create):`, JSON.stringify(updateError, null, 2));
      return res.status(500).json({
        success: false,
        error: 'Failed to update event data.',
        code: 'DATABASE_ERROR',
      });
    }

    // Step 3: Success response
    res.status(200).json({
      success: true,
      message: `Application ${status}`,
    });

  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error updating application status:`, JSON.stringify(error, null, 2));
    res.status(500).json({
      success: false,
      error: 'Internal server error.',
      code: 'INTERNAL_ERROR',
      details: process.env.NODE_ENV === 'development' ? { message: error.message, stack: error.stack } : undefined,
    });
  }
});



//getting events
app.get('/events/organizer/:phone_number', async (req, res) => {
  try {
    const { phone_number } = req.params;

    // Step 1: Validate the organizer's phone number
    if (!phone_number) {
      return res.status(400).json({
        success: false,
        error: 'Organizer phone number is required',
      });
    }

    // Step 2: Fetch organizer details including average_rating
    const { data: organizer, error: organizerError } = await supabase
      .from('company_registration')
      .select('company_name, contact_person_name, average_rating')
      .eq('phone_number', phone_number)
      .single();

    if (organizerError) {
      console.error('Supabase Organizer Fetch Error:', organizerError);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch organizer details',
      });
    }

    if (!organizer) {
      return res.status(404).json({
        success: false,
        error: 'Organizer not found',
      });
    }

    // Step 3: Fetch all events created by the organizer
    const { data: events, error: eventsError } = await supabase
      .from('event_create')
      .select('*')
      .eq('organizer_phone_number', phone_number);

    if (eventsError) {
      throw eventsError;
    }

    if (!events || events.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No events found for this organizer',
        data: [],
        organizer: {
          company_name: organizer.company_name,
          contact_person_name: organizer.contact_person_name,
          average_rating: organizer.average_rating || null
        }
      });
    }

    // Step 4: For each event, fetch applied and accepted members with their details
    const eventsWithMembers = await Promise.all(
      events.map(async (event) => {
        // Fetch all applied members for the event from event_applications
        const { data: appliedMembers, error: appliedError } = await supabase
          .from('event_applications')
          .select('phone_number, images')
          .eq('event_id', event.id);

        if (appliedError) {
          throw appliedError;
        }

        // Parse accepted_members from event_create
        let acceptedMembersIds = safeParseJson(event.accepted_members) || [];
        if (!Array.isArray(acceptedMembersIds)) {
          acceptedMembersIds = acceptedMembersIds ? [acceptedMembersIds] : [];
        }
        

        // Fetch user details for all applied members
        const phoneNumbers = appliedMembers.map((member) => member.phone_number);
        const { data: users, error: usersError } = await supabase
          .from('user1')
          .select('first_name, last_name, age, experience, gender, location, profile_pic, phone_number')
          .in('phone_number', phoneNumbers);

        if (usersError) {
          throw usersError;
        }

        // Combine user details with application data (including images)
        const appliedMembersWithDetails = appliedMembers.map((member) => {
          const user = users.find((u) => u.phone_number === member.phone_number);
          return {
            first_name: user?.first_name || null,
            last_name: user?.last_name || null,
            age: user?.age || null,
            experience: user?.experience || null,
            gender: user?.gender || null,
            location: user?.location || null,
            profile_pic: user?.profile_pic || null,
            images: member.images || []
          };
        });

        // Filter accepted members based on accepted_members from event_create
        const accepted_members = appliedMembersWithDetails.filter((member) =>
          acceptedMembersIds.includes(member.phone_number)
        );
        const applied_members = appliedMembersWithDetails;

        return {
          ...event,
          applied_members_count: applied_members.length,
          accepted_members_count: accepted_members.length,
          applied_members: applied_members,
          accepted_members: accepted_members
        };
      })
    );

    // Step 5: Return the response
    res.status(200).json({
      success: true,
      message: 'Events fetched successfully',
      data: eventsWithMembers,
      organizer: {
        company_name: organizer.company_name,
        contact_person_name: organizer.contact_person_name,
        average_rating: organizer.average_rating || null
      }
    });

  } catch (error) {
    console.error('Error fetching organizer events:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch organizer events',
    });
  }
});
app.get('/api/events/:event_id/applied-members', async (req, res) => {
  try {
    const { event_id } = req.params;

    if (!event_id) {
      return res.status(400).json({
        success: false,
        error: 'Event ID is required',
        code: 'MISSING_EVENT_ID',
      });
    }

    console.log(`Fetching applied members for event: ${event_id}`);

    // Fetch event with additional details
    const { data: event, error: eventError } = await supabase
      .from('event_create')
      .select('id, event_name, applied_members, accepted_members, male_crew, female_crew, male_crew_pay, female_crew_pay, location, start_date, end_date, status_to_pay')
      .eq('id', event_id)
      .single();

    if (eventError) {
      console.error('Supabase Fetch Error:', eventError);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch event from the database',
        code: 'DATABASE_ERROR',
        details: eventError.message,
      });
    }

    if (!event) {
      return res.status(404).json({
        success: false,
        error: 'Event not found',
        code: 'EVENT_NOT_FOUND',
      });
    }

    // Calculate total_need_pay: (male_crew * male_crew_pay) + (female_crew * female_crew_pay) + 13%
    const maleCrewCost = (event.male_crew || 0) * (event.male_crew_pay || 0);
    const femaleCrewCost = (event.female_crew || 0) * (event.female_crew_pay || 0);
    const subtotal = maleCrewCost + femaleCrewCost;
    const total_need_pay = subtotal * 1.13;
    // Calculate gig_worker
    const gig_worker = (event.male_crew || 0) + (event.female_crew || 0);

    // Parse applied_members
    let appliedMembers;
    try {
      appliedMembers = typeof event.applied_members === "string"
        ? JSON.parse(event.applied_members)
        : event.applied_members || [];
    } catch (parseError) {
      console.error('Error parsing applied_members:', parseError);
      return res.status(500).json({
        success: false,
        error: 'Failed to parse applied members',
        code: 'PARSE_ERROR',
      });
    }

    // Parse accepted_members for status_to_pay
    let acceptedMembers;
    try {
      acceptedMembers = typeof event.accepted_members === "string"
        ? JSON.parse(event.accepted_members)
        : event.accepted_members || [];
    } catch (parseError) {
      console.error('Error parsing accepted_members:', parseError);
      return res.status(500).json({
        success: false,
        error: 'Failed to parse accepted members',
        code: 'PARSE_ERROR',
      });
    }

    // Calculate status_to_pay
    const totalCrewRequired = (event.male_crew || 0) + (event.female_crew || 0);
    const status_to_pay = acceptedMembers.length === totalCrewRequired;

    if (appliedMembers.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No applied members found',
        event_details: {
          id: event.id,
          event_name: event.event_name,
          male_crew: event.male_crew || 0,
          female_crew: event.female_crew || 0,
          male_crew_pay: event.male_crew_pay || 0,
          female_crew_pay: event.female_crew_pay || 0,
          total_need_pay: Number(total_need_pay.toFixed(2)),
          gig_worker,
          location: event.location || null,
          start_date: event.start_date || null,
          end_date: event.end_date || null,
          status_to_pay,
        },
        applied_members: [],
      });
    }

    // Fetch user details
    const { data: users, error: usersError } = await supabase
      .from('user1')
      .select('phone_number, first_name, last_name, email, location, gender, dob, age, experience, profile_pic, average_rating')
      .in('phone_number', appliedMembers);

    if (usersError) {
      console.error('Error fetching users:', usersError);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch user details',
        code: 'DATABASE_ERROR',
        details: usersError.message,
      });
    }

    console.log('Fetched users:', users);

    // Fetch application details including images and experience
    const { data: applications, error: applicationsError } = await supabase
      .from('event_applications')
      .select('phone_number, images, experience')
      .eq('event_id', event_id)
      .in('phone_number', appliedMembers);

    if (applicationsError) {
      console.error('Error fetching applications:', applicationsError);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch application details',
        code: 'DATABASE_ERROR',
        details: applicationsError.message,
      });
    }

    console.log('Fetched applications:', applications);

    // Enrich applied members
    const enrichedApplied = appliedMembers.map(phone => {
      const user = users.find(u => u.phone_number === phone) || {};
      const application = applications.find(app => app.phone_number === phone) || {};
      return {
        phone_number: phone,
        first_name: user.first_name || null,
        last_name: user.last_name || null,
        email: user.email || null,
        location: user.location || null,
        gender: user.gender || null,
        dob: user.dob || null,
        age: user.age || null,
        profile_pic: user.profile_pic || null,
        average_rating: user.average_rating || null,
        application_images: application.images || [],
        experience: application.experience || null,
      };
    });

    res.status(200).json({
      success: true,
      message: 'Applied members fetched successfully',
      event_details: {
        id: event.id,
        event_name: event.event_name,
        male_crew: event.male_crew || 0,
        female_crew: event.female_crew || 0,
        male_crew_pay: event.male_crew_pay || 0,
        female_crew_pay: event.female_crew_pay || 0,
        total_need_pay: Number(total_need_pay.toFixed(2)),
        gig_worker,
        location: event.location || null,
        start_date: event.start_date || null,
        end_date: event.end_date || null,
        status_to_pay,
      },
      applied_members: enrichedApplied,
    });
  } catch (error) {
    console.error('Server Error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
      details: error.message,
    });
  }
});

//admin panel

app.get('/api/ongoing-events-accepted-members-details', async (req, res) => {
  try {
    // Get current date in YYYY-MM-DD format for comparison
    const currentDate = new Date().toISOString().split('T')[0];

    // 1. Fetch ongoing events from event_create
    const { data: events, error: eventsError } = await supabase
      .from('event_create')
      .select('id, event_name, accepted_members, start_date, end_date')
      .lte('start_date', currentDate) // Event started on or before today
      .gte('end_date', currentDate); // Event ends on or after today

    if (eventsError) {
      console.error('Supabase Events Fetch Error:', eventsError);
      return res.status(500).json({ success: false, error: eventsError.message });
    }

    if (!events || events.length === 0) {
      return res.status(200).json({ 
        success: true, 
        message: 'No ongoing events found' 
      });
    }

    // 2. For each event, fetch accepted members details from user1 table
    const eventsWithMembers = await Promise.all(
      events.map(async (event) => {
        let acceptedMembersDetails = [];

        // Handle accepted_members (assuming it's an array of phone numbers)
        if (event.accepted_members && Array.isArray(event.accepted_members)) {
          // Fetch users from user1 based on phone_numbers
          const { data: members, error: membersError } = await supabase
            .from('user1')
            .select('*')
            .in('phone_number', event.accepted_members);

          if (membersError) {
            console.error(`Error fetching members for event ${event.id}:`, membersError);
            // Continue even if error for this event
          } else {
            acceptedMembersDetails = members || [];
          }
        }

        return {
          event_id: event.id,
          event_name: event.event_name,
          accepted_members_details: acceptedMembersDetails
        };
      })
    );

    // 3. Return the response
    res.status(200).json({
      success: true,
      events: eventsWithMembers
    });

  } catch (error) {
    console.error('Server Error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});


app.post('/api/events/apply', upload.array('images', 5), async (req, res) => {
  try {
    console.log('Request Body:', req.body);
    console.log('Uploaded Files:', req.files);

    const { phone_number, event_id, experience } = req.body; // Changed from experiences to experience

    // Input validation
    if (!phone_number || !event_id) {
      return res.status(400).json({ success: false, error: 'Missing phone_number or event_id' });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, error: 'No images uploaded' });
    }

    // Validate experience (optional field)
    if (experience && typeof experience !== 'string' && typeof experience !== 'object') {
      return res.status(400).json({ success: false, error: 'Experience must be a string or object' });
    }

    // Convert experience to a string or JSON string if it’s an object
    const formattedExperience = experience 
      ? typeof experience === 'object' 
        ? JSON.stringify(experience) 
        : experience 
      : null;

    // Step 1: Upload images to Supabase Storage
    const imageUrls = await Promise.all(
      req.files.map(async (file) => {
        const fileName = `${Date.now()}_${file.originalname}`;
        const { error: uploadError } = await supabase.storage
          .from('event_uploads')
          .upload(fileName, file.buffer, {
            contentType: file.mimetype,
          });

        if (uploadError) {
          console.error('Supabase Upload Error:', uploadError);
          throw new Error(`Failed to upload image: ${uploadError.message}`);
        }

        return `${supabaseUrl}/storage/v1/object/public/event_uploads/${fileName}`;
      })
    );

    // Step 2: Fetch current event data
    const { data: event, error: fetchError } = await supabase
      .from('event_create')
      .select('saved, applied_members')
      .eq('id', event_id)
      .single();

    if (fetchError || !event) {
      console.error('Supabase Fetch Error:', fetchError);
      return res.status(404).json({ success: false, error: 'Event not found', details: fetchError.details || null });
    }

    const trimmedPhoneNumber = String(phone_number).trim();
    const savedList = Array.isArray(event.saved) ? event.saved.filter(num => num !== '') : [];
    const appliedMembers = Array.isArray(event.applied_members) ? event.applied_members.filter(num => num !== '') : [];

    // Step 3: Check if already applied
    if (appliedMembers.includes(trimmedPhoneNumber)) {
      return res.status(409).json({ success: false, error: 'User has already applied to this event' });
    }

    // Step 4: Update saved and applied_members
    const updatedSavedList = savedList.filter(num => num !== trimmedPhoneNumber);
    const updatedAppliedMembers = [...appliedMembers, trimmedPhoneNumber];

    const { error: updateError } = await supabase
      .from('event_create')
      .update({
        saved: updatedSavedList.length > 0 ? updatedSavedList : null,
        applied_members: updatedAppliedMembers,
      })
      .eq('id', event_id);

    if (updateError) {
      console.error('Supabase Update Error:', updateError);
      throw new Error(`Failed to update event: ${updateError.message}`);
    }

    // Step 5: Insert the application into event_applications
    const { data: applicationData, error: applicationError } = await supabase
      .from('event_applications')
      .insert([{ 
        phone_number: trimmedPhoneNumber, 
        event_id, 
        images: imageUrls, 
        experience: formattedExperience // Changed from experiences to experience
      }])
      .select('*')
      .single();

    if (applicationError) {
      console.error('Supabase Insert Error:', applicationError);
      throw new Error(`Failed to insert application: ${applicationError.message}`);
    }

    res.status(201).json({
      success: true,
      message: 'Applied successfully and removed from saved events!',
      data: applicationData,
    });
  } catch (error) {
    console.error('Error applying for event:', error.message);
    res.status(500).json({ success: false, error: error.message, details: error.details || null });
  }
});
// ADMIN PANEL


app.get('/api/accepted-members-details', async (req, res) => {
  try {
    // 1. Fetch all events from event_create
    const { data: events, error: eventsError } = await supabase
      .from('event_create')
      .select('id, event_name, accepted_members');

    if (eventsError) {
      console.error('Supabase Events Fetch Error:', eventsError);
      return res.status(500).json({ success: false, error: eventsError.message });
    }

    if (!events || events.length === 0) {
      return res.status(200).json({ 
        success: true, 
        message: 'No events found' 
      });
    }

    // 2. For each event, fetch accepted members details from user1 table
    const eventsWithMembers = await Promise.all(
      events.map(async (event) => {
        let acceptedMembersDetails = [];

        // Handle accepted_members (assuming it's an array of phone numbers)
        if (event.accepted_members && Array.isArray(event.accepted_members)) {
          // Fetch users from user1 based on phone_numbers
          const { data: members, error: membersError } = await supabase
            .from('user1')
            .select('*')
            .in('phone_number', event.accepted_members);

          if (membersError) {
            console.error(`Error fetching members for event ${event.id}:`, membersError);
            // Continue even if error for this event
          } else {
            acceptedMembersDetails = members || [];
          }
        }

        return {
          event_id: event.id,
          event_name: event.event_name,
          accepted_members_details: acceptedMembersDetails
        };
      })
    );

    // 3. Return the response
    res.status(200).json({
      success: true,
      events: eventsWithMembers
    });

  } catch (error) {
    console.error('Server Error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});




app.get('/api/company/registration', async (req, res) => {
  try {
    // Fetch all records from company_registration table
    const { data: companies, error: fetchError } = await supabase
      .from('company_registration')
      .select('*');

    if (fetchError) {
      console.error('Error fetching company registrations:', fetchError);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch company registrations',
        code: 'DATABASE_ERROR',
        details: fetchError.message,
      });
    }

    if (!companies || companies.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No company registrations found',
        companies: [],
      });
    }

    res.status(200).json({
      success: true,
      message: 'Company registrations retrieved successfully',
      companies: companies,
    });
  } catch (error) {
    console.error('Unexpected Error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
      details: error.message,
    });
  }
});


app.get('/api/gigworkers/all-stats', async (req, res) => {
  try {
    console.log('Request URL:', req.url); // Debug the exact route

    // Fetch all events
    const { data: events, error: fetchError } = await supabase
      .from('event_create')
      .select('applied_members, accepted_members, rejected_members');

    if (fetchError) {
      console.error('Error fetching events:', fetchError);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch events',
        code: 'DATABASE_ERROR',
        details: fetchError.message,
      });
    }

    if (!events || events.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No events found',
        workers: [],
      });
    }

    // Collect all unique phone numbers
    const allPhoneNumbers = new Set();
    events.forEach(event => {
      if (Array.isArray(event.applied_members)) event.applied_members.forEach(phone => allPhoneNumbers.add(phone));
      if (Array.isArray(event.accepted_members)) event.accepted_members.forEach(phone => allPhoneNumbers.add(phone));
      if (Array.isArray(event.rejected_members)) event.rejected_members.forEach(phone => allPhoneNumbers.add(phone));
    });

    if (allPhoneNumbers.size === 0) {
      return res.status(200).json({
        success: true,
        message: 'No gig workers found in events',
        workers: [],
      });
    }

    // Fetch all gig worker details from user1 table
    const { data: users, error: usersError } = await supabase
      .from('user1')
      .select('*')
      .in('phone_number', Array.from(allPhoneNumbers));

    if (usersError) {
      console.error('Error fetching users:', usersError);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch user details',
        code: 'DATABASE_ERROR',
        details: usersError.message,
      });
    }

    // Calculate stats for each worker
    const workerStats = users.map(user => {
      const stats = {
        applied_count: 0,
        accepted_count: 0,
        rejected_count: 0,
      };

      events.forEach(event => {
        if (Array.isArray(event.applied_members) && event.applied_members.includes(user.phone_number)) {
          stats.applied_count++;
        }
        if (Array.isArray(event.accepted_members) && event.accepted_members.includes(user.phone_number)) {
          stats.accepted_count++;
        }
        if (Array.isArray(event.rejected_members) && event.rejected_members.includes(user.phone_number)) {
          stats.rejected_count++;
        }
      });

      return {
        ...user,
        ...stats,
      };
    });

    res.status(200).json({
      success: true,
      message: 'Gig worker details and event stats retrieved successfully',
      workers: workerStats,
    });
  } catch (error) {
    console.error('Unexpected Error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
      details: error.message,
    });
  }
});


app.get('/api/gigworker/:phone_number', async (req, res) => {
  try {
    const { phone_number } = req.params;

    // Validate phone number format
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    if (!phoneRegex.test(phone_number)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid phone number format',
        code: 'INVALID_PHONE_NUMBER',
      });
    }

    // Fetch gig worker details from user1 table
    const { data: user, error: userError } = await supabase
      .from('user1')
      .select('*')
      .eq('phone_number', phone_number)
      .single();

    if (userError) {
      console.error('Error fetching user:', userError);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch user details',
        code: 'DATABASE_ERROR',
        details: userError.message,
      });
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'Gig worker not found',
        code: 'NOT_FOUND',
      });
    }

    // Fetch all events to count participation
    const { data: events, error: eventsError } = await supabase
      .from('event_create')
      .select('applied_members, accepted_members, rejected_members');

    if (eventsError) {
      console.error('Error fetching events:', eventsError);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch events',
        code: 'DATABASE_ERROR',
        details: eventsError.message,
      });
    }

    // Calculate counts
    let appliedCount = 0;
    let acceptedCount = 0;
    let rejectedCount = 0;

    events.forEach(event => {
      if (Array.isArray(event.applied_members) && event.applied_members.includes(phone_number)) {
        appliedCount++;
      }
      if (Array.isArray(event.accepted_members) && event.accepted_members.includes(phone_number)) {
        acceptedCount++;
      }
      if (Array.isArray(event.rejected_members) && event.rejected_members.includes(phone_number)) {
        rejectedCount++;
      }
    });

    res.status(200).json({
      success: true,
      message: 'Gig worker details and event stats retrieved successfully',
      user_details: user,
      event_stats: {
        applied_count: appliedCount,
        accepted_count: acceptedCount,
        rejected_count: rejectedCount,
      },
    });
  } catch (error) {
    console.error('Unexpected Error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
      details: error.message,
    });
  }
});

app.get('/api/event-details', async (req, res) => {
  try {
    // Step 1: Fetch all event details with company registration data
    const { data: events, error: eventsError } = await supabase
      .from('event_create')
      .select(`
        total_pay,
        male_crew_pay,
        female_crew_pay,
        company_registration:organizer_phone_number (
          phone_number,
          company_name,
          gst_number
        )
      `);

    if (eventsError) {
      throw eventsError;
    }

    if (!events || events.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No events found',
      });
    }

    // Step 2: Format the response to include company details
    const formattedEvents = events.map(event => ({
      total_pay: event.total_pay,
      male_crew_pay: event.male_crew_pay,
      female_crew_pay: event.female_crew_pay,
      organizer_company: {
        phone_number: event.company_registration?.phone_number || null,
        company_name: event.company_registration?.company_name || null,
        gst_number: event.company_registration?.gst_number || null,
      },
      company_registration: undefined, // Remove the nested object if not needed
    }));

    // Step 3: Return the response
    res.status(200).json({
      success: true,
      message: 'Event details fetched successfully',
      data: formattedEvents,
    });
  } catch (error) {
    console.error('Error fetching event details:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch event details',
    });
  }
});

//5.  For each event , How much has the organizer paid money to KrewsUp

app.get('/api/payments-with-event-name', async (req, res) => {
  try {
    // Step 1: Fetch all payments
    const { data: payments, error: paymentsError } = await supabase
      .from('payments')
      .select('*');

    if (paymentsError) {
      console.error('Error fetching payments:', paymentsError);
      return res.status(500).json({ success: false, error: 'Failed to fetch payments' });
    }

    if (!payments || payments.length === 0) {
      return res.status(404).json({ success: false, error: 'No payments found' });
    }

    // Step 2: Extract unique event_ids
    const eventIds = [...new Set(payments.map(p => p.event_id))];

    // Step 3: Fetch event_name for those event_ids
    const { data: events, error: eventsError } = await supabase
      .from('event_create')
      .select('id, event_name')
      .in('id', eventIds);

    if (eventsError) {
      console.error('Error fetching events:', eventsError);
      return res.status(500).json({ success: false, error: 'Failed to fetch event names' });
    }

    // Step 4: Map event_id to event_name
    const eventMap = {};
    events.forEach(event => {
      eventMap[event.id] = event.event_name;
    });

    // Step 5: Enrich payments with event_name
    const enrichedPayments = payments.map(payment => ({
      ...payment,
      event_name: eventMap[payment.event_id] || null
    }));

    res.status(200).json({
      success: true,
      message: 'Payments with event names fetched successfully',
      payments: enrichedPayments,
    });

  } catch (err) {
    console.error('Server Error:', err.message);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});


// admin panel


//events start and end
app.post('/api/start-event', async (req, res) => {
  try {
    const { event_id, organizerPhone } = req.body;

    if (!event_id || !organizerPhone) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: event_id and/or organizerPhone',
      });
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(event_id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid event_id format. Must be a valid UUID.',
      });
    }

    const { data: event, error: updateError } = await supabase
      .from('event_create')
      .update({ status: 'started' })
      .eq('id', event_id)
      .eq('status', 'not_started')
      .select('*')
      .single();

    if (updateError) {
      return res.status(500).json({
        success: false,
        error: 'Failed to start event.',
        details: updateError.message,
      });
    }

    res.status(200).json({
      success: true,
      message: 'Event status updated to started successfully!',
      event,
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: 'Server error occurred.',
      details: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error',
    });
  }
});
app.post('/api/get-non-completed-events', async (req, res) => {
  try {
    const { organizerPhone } = req.body;

    if (!organizerPhone) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: organizerPhone',
      });
    }

    const { data: events, error: fetchError } = await supabase
      .from('event_create')
      .select('*')
      .eq('organizer_phone_number', organizerPhone)
      .not('status', 'in.("completed","ended")'); // ✅ Fixed syntax

    if (fetchError) {
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch events.',
        details: fetchError.message,
      });
    }

    return res.status(200).json({
      success: true,
      message: events.length > 0
        ? 'Ongoing or upcoming events retrieved successfully.'
        : 'No active or upcoming events found.',
      events,
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: 'Server error occurred.',
      details: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error',
    });
  }
});

app.post('/api/end-event', async (req, res) => {
  try {
    const { event_id } = req.body;

    if (!event_id) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: event_id',
      });
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(event_id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid event_id format. Must be a valid UUID.',
      });
    }

    const { data: updatedEvent, error: updateError } = await supabase
      .from('event_create')
      .update({ status: 'completed' })
      .eq('id', event_id)
      .eq('status', 'started') // Only allow ending if event is already started
      .select('*');

    if (updateError || !updatedEvent || updatedEvent.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Event not found or not in a valid state to end.',
        details: updateError?.message || 'No matching event found.',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Event status updated to completed successfully!',
      event: updatedEvent[0],
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: 'Server error occurred.',
      details: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error',
    });
  }
});

app.post('/api/get-completed-events', async (req, res) => {
  try {
    const { organizerPhone } = req.body;

    if (!organizerPhone) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: organizerPhone',
      });
    }

    const { data: events, error: fetchError } = await supabase
      .from('event_create')
      .select('*')
      .eq('organizer_phone_number', organizerPhone)
      .eq('status', 'completed');

    if (fetchError) {
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch completed events.',
        details: fetchError.message,
      });
    }

    const storageUrl = supabase.storage.from('posters').getPublicUrl('').data.publicUrl;

    const eventsWithPosters = events.map(event => ({
      ...event,
      poster_file: event.poster_file ? `${storageUrl}${event.poster_file}` : null,
    }));

    res.status(200).json({
      success: true,
      message: 'Completed events retrieved successfully!',
      events: eventsWithPosters,
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: 'Server error occurred.',
      details: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error',
    });
  }
});



app.get('/api/events/:event_id/accepted-members', async (req, res) => {
  try {
    const { event_id } = req.params;

    if (!event_id) {
      return res.status(400).json({
        success: false,
        error: 'Event ID is required',
        code: 'MISSING_EVENT_ID',
      });
    }

    console.log(`Fetching accepted members for event: ${event_id}`);

    const { data: event, error: eventError } = await supabase
      .from('event_create')
      .select('id, event_name, accepted_members, male_crew, female_crew, male_crew_pay, female_crew_pay, location, start_date, end_date, status_to_pay')
      .eq('id', event_id)
      .single();

    if (eventError) {
      console.error('Supabase Fetch Error:', eventError);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch event from the database',
        code: 'DATABASE_ERROR',
        details: eventError.message,
      });
    }

    if (!event) {
      return res.status(404).json({
        success: false,
        error: 'Event not found',
        code: 'EVENT_NOT_FOUND',
      });
    }

    const maleCrewCost = (event.male_crew || 0) * (event.male_crew_pay || 0);
    const femaleCrewCost = (event.female_crew || 0) * (event.female_crew_pay || 0);
    const subtotal = maleCrewCost + femaleCrewCost;

    const startDate = new Date(event.start_date);
    const endDate = new Date(event.end_date);
    const numberOfDays = event.start_date && event.end_date ? Math.max(1, Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1) : 1;

    const total_need_pay = Number((subtotal * 1.13 * numberOfDays).toFixed(2));
    const gig_worker = (event.male_crew || 0) + (event.female_crew || 0);

    let acceptedMembers;
    try {
      acceptedMembers = typeof event.accepted_members === "string"
        ? JSON.parse(event.accepted_members)
        : event.accepted_members || [];
    } catch (parseError) {
      console.error('Error parsing accepted_members:', parseError);
      return res.status(500).json({
        success: false,
        error: 'Failed to parse accepted members',
        code: 'PARSE_ERROR',
      });
    }

    const totalCrewRequired = (event.male_crew || 0) + (event.female_crew || 0);
    const status_to_pay = acceptedMembers.length === totalCrewRequired;

    if (acceptedMembers.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No accepted members found',
        event_details: {
          id: event.id,
          event_name: event.event_name,
          male_crew: event.male_crew || 0,
          female_crew: event.female_crew || 0,
          male_crew_pay: event.male_crew_pay || 0,
          female_crew_pay: event.female_crew_pay || 0,
          total_need_pay: total_need_pay,
          gig_worker,
          location: event.location || null,
          start_date: event.start_date || null,
          end_date: event.end_date || null,
          status_to_pay,
        },
        accepted_members: [],
      });
    }

    const { data: users, error: usersError } = await supabase
      .from('user1')
      .select('phone_number, first_name, last_name, email, location, gender, dob, age, experience, profile_pic')
      .in('phone_number', acceptedMembers);

    if (usersError) {
      console.error('Error fetching users:', usersError);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch user details',
        code: 'DATABASE_ERROR',
        details: usersError.message,
      });
    }

    console.log('Fetched users:', users);

    const { data: applications, error: applicationsError } = await supabase
      .from('event_applications')
      .select('phone_number, images, experience')
      .eq('event_id', event_id)
      .in('phone_number', acceptedMembers);

    if (applicationsError) {
      console.error('Error fetching applications:', applicationsError);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch application details',
        code: 'DATABASE_ERROR',
        details: applicationsError.message,
      });
    }

    console.log('Fetched applications:', applications);

    const enrichedAccepted = acceptedMembers.map(phone => {
      const user = users.find(u => u.phone_number === phone) || {};
      const application = applications.find(app => app.phone_number === phone) || {};
      return {
        phone_number: phone,
        first_name: user.first_name || null,
        last_name: user.last_name || null,
        email: user.email || null,
        location: user.location || null,
        gender: user.gender || null,
        dob: user.dob || null,
        age: user.age || null,
        profile_pic: user.profile_pic || null,
        application_images: application.images || [],
        experience: application.experience || null,
      };
    });

    res.status(200).json({
      success: true,
      message: 'Accepted members fetched successfully',
      event_details: {
        id: event.id,
        event_name: event.event_name,
        male_crew: event.male_crew || 0,
        female_crew: event.female_crew || 0,
        male_crew_pay: event.male_crew_pay || 0,
        female_crew_pay: event.female_crew_pay || 0,
        total_need_pay: total_need_pay,
        gig_worker,
        location: event.location || null,
        start_date: event.start_date || null,
        end_date: event.end_date || null,
        status_to_pay,
      },
      accepted_members: enrichedAccepted,
    });
  } catch (error) {
    console.error('Server Error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
      details: error.message,
    });
  }
});

app.get('/api/search', async (req, res) => {
  try {
    const { query } = req.query;

    // Step 1: Validate the search query
    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Search query is required',
      });
    }

    // Step 2: Search for events
    const { data: events, error: eventsError } = await supabase
      .from('event_create')
      .select('*')
      .ilike('event_name', `%${query}%`) // Case-insensitive search for event name
      .or(`location.ilike.%${query}%,job_title.ilike.%${query}%`); // Search in location or job title

    if (eventsError) {
      throw eventsError;
    }

    // Step 3: Search for users
    const { data: users, error: usersError } = await supabase
      .from('user1')
      .select('first_name, last_name, gender, experience, location, age, phone_number')
      .or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,location.ilike.%${query}%`); // Search in first name, last name, or location

    if (usersError) {
      throw usersError;
    }

    // Step 4: Return the combined search results
    res.status(200).json({
      success: true,
      message: 'Search results fetched successfully',
      data: {
        events: events || [],
        users: users || [],
      },
    });
  } catch (error) {
    console.error('Error during search:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to perform search',
    });
  }
});





// Make sure this route is added in your server file
app.post('/api/create-event', async (req, res) => {
  try {
    const {
      eventName,
      poster,
      startDate,
      endDate,
      startTime,
      endTime,
      location,
      jobTitle,
      jobSpecifications = null,
      dressCode = null,
      foodProvided = false,
      transportProvided = false,
      maleCrewPay = 0,
      femaleCrewPay = 0,
      maleCrew = 0, // Added male_crew
      femaleCrew = 0, // Added female_crew
      additionalDetails = null,
      organizerPhone,
    } = req.body;

    // Log incoming values for debugging
    console.log('Received values:', {
      maleCrewPay,
      femaleCrewPay,
      maleCrew,
      femaleCrew,
    });

    // Validate required fields
    if (!eventName || !startDate || !endDate || !startTime || !endTime || !location || !jobTitle || !organizerPhone) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: eventName, startDate, endDate, startTime, endTime, location, jobTitle, organizerPhone',
      });
    }

    // Validate pay values
    const malePay = Number(maleCrewPay);
    const femalePay = Number(femaleCrewPay);
    if (isNaN(malePay) || isNaN(femalePay) || malePay < 0 || femalePay < 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid pay values. maleCrewPay and femaleCrewPay must be non-negative numbers.',
      });
    }

    // Validate crew counts
    const maleCrewCount = Number(maleCrew);
    const femaleCrewCount = Number(femaleCrew);
    if (isNaN(maleCrewCount) || isNaN(femaleCrewCount) || maleCrewCount < 0 || femaleCrewCount < 0 || !Number.isInteger(maleCrewCount) || !Number.isInteger(femaleCrewCount)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid crew values. maleCrew and femaleCrew must be non-negative integers.',
      });
    }

    // Log converted values
    console.log('Converted values:', {
      malePay,
      femalePay,
      maleCrewCount,
      femaleCrewCount,
    });

    // Validate date format
    if (isNaN(Date.parse(startDate)) || isNaN(Date.parse(endDate))) {
      return res.status(400).json({
        success: false,
        error: 'Invalid date format. Use YYYY-MM-DD.',
      });
    }

    // Validate time format (HH:MM)
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (!timeRegex.test(startTime) || !timeRegex.test(endTime)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid time format. Use HH:MM (24-hour format).',
      });
    }

    // Calculate number of days
    const start = new Date(startDate);
    const end = new Date(endDate);
    const timeDiff = end - start;
    const daysDiff = Math.ceil(timeDiff / (1000 * 60 * 60 * 24)); // Convert milliseconds to days and round up
    if (daysDiff < 0) {
      return res.status(400).json({
        success: false,
        error: 'endDate must be on or after startDate.',
      });
    }

    // Calculate total pay
    const basePay = (malePay * maleCrewCount) + (femalePay * femaleCrewCount);
    const withTax = basePay * 1.13; // Add 13% (1.13 = 100% + 13%)
    const totalPay = withTax * daysDiff;

    // Prepare data for insertion
    const insertData = {
      event_name: eventName,
      poster_file: poster,
      start_date: startDate,
      end_date: endDate,
      start_time: startTime,
      end_time: endTime,
      location,
      job_title: jobTitle,
      job_specifications: jobSpecifications,
      dress_code: dressCode,
      food_provided: foodProvided,
      transport_provided: transportProvided,
      male_crew_pay: malePay,
      female_crew_pay: femalePay,
      male_crew: maleCrewCount,
      female_crew: femaleCrewCount,
      total_pay: totalPay,
      additional_details: additionalDetails,
      organizer_phone_number: organizerPhone,
    };

    // Log data to be inserted
    console.log('Inserting data:', insertData);

    // Insert into Supabase
    const { data, error } = await supabase
      .from('event_create')
      .insert([insertData])
      .select('*');

    // Check for Supabase errors
    if (error) {
      console.error('Supabase Insert Error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to create event. Supabase error.',
        details: error.message,
      });
    }

    // Verify inserted data
    console.log('Inserted event:', data[0]);

    // Check if pay and crew values were stored correctly
    if (
      data[0].male_crew_pay !== malePay ||
      data[0].female_crew_pay !== femalePay ||
      data[0].male_crew !== maleCrewCount ||
      data[0].female_crew !== femaleCrewCount
    ) {
      console.error('Value mismatch:', {
        expected: { malePay, femalePay, maleCrewCount, femaleCrewCount },
        got: {
          male_crew_pay: data[0].male_crew_pay,
          female_crew_pay: data[0].female_crew_pay,
          male_crew: data[0].male_crew,
          female_crew: data[0].female_crew,
        },
      });
      return res.status(500).json({
        success: false,
        error: 'Failed to store pay or crew values correctly.',
      });
    }

    // Success Response
    res.status(201).json({
      success: true,
      message: 'Event created successfully!',
      event: data[0],
    });

  } catch (err) {
    console.error('Server Error:', {
      message: err.message,
      stack: err.stack,
      timestamp: new Date().toISOString(),
    });
    res.status(500).json({
      success: false,
      error: 'Server error occurred.',
      details: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error',
    });
  }
});

app.get('/api/events', async (req, res) => {
  try {
    // 1. Fetch only needed event fields
    const { data: events, error: eventsError } = await supabase
      .from('event_create')
      .select(`
        id,
        organizer_phone_number,
        event_name,
        poster_file,
        start_date,
        end_date,
        start_time,
        end_time,
        location,
        job_title,
        status,
        created_at,
        male_crew,
        female_crew,
        accepted_members,
        applied_members,
        male_crew_pay,
        female_crew_pay,
        total_pay,
        additional_details
      `);

    if (eventsError) {
      console.error('Supabase Events Fetch Error:', eventsError);
      return res.status(500).json({ success: false, error: eventsError.message });
    }

    if (!events || events.length === 0) {
      return res.status(200).json({ 
        success: true, 
        message: 'No events found',
        events: []
      });
    }

    // 2. Fetch all organizers in one query (avoid N+1 problem)
    const uniquePhoneNumbers = [...new Set(events.map(e => e.organizer_phone_number))];

    const { data: organizers, error: orgError } = await supabase
      .from('company_registration')
      .select('phone_number, company_name, contact_person_name, average_rating')
      .in('phone_number', uniquePhoneNumbers);

    if (orgError) {
      console.error('Error fetching organizers:', orgError);
    }

    // Map organizers for quick lookup
    const organizerMap = {};
    if (organizers) {
      organizers.forEach(org => {
        organizerMap[org.phone_number] = {
          company_name: org.company_name,
          contact_person_name: org.contact_person_name,
          average_rating: org.average_rating || null
        };
      });
    }

    // 3. Enrich events with organizer info & slots left
    const enrichedEvents = events.map(event => {
      // Total crew slots
      const totalCrewSlots = (event.male_crew || 0) + (event.female_crew || 0);

      // Count accepted members
      let acceptedMembersCount = 0;
      if (Array.isArray(event.accepted_members)) {
        acceptedMembersCount = event.accepted_members.length;
      } else if (event.accepted_members && typeof event.accepted_members === 'object') {
        acceptedMembersCount = Object.keys(event.accepted_members).length;
      } else if (typeof event.accepted_members === 'number') {
        acceptedMembersCount = event.accepted_members;
      }

      // Calculate slots left (no negatives)
      const slotsLeft = Math.max(0, totalCrewSlots - acceptedMembersCount);

      return {
        ...event,
        organizer: organizerMap[event.organizer_phone_number] || null,
        slots_left: slotsLeft
      };
    });

    // 4. Send final response
    res.status(200).json({
      success: true,
      events: enrichedEvents
    });

  } catch (error) {
    console.error('Server Error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});



app.get('/api/events/applications/:phone_number', async (req, res) => {
  try {
    const { phone_number } = req.params;

    // Input validation
    if (!phone_number || typeof phone_number !== 'string' || phone_number.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Valid phone number is required'
      });
    }

    console.log('Fetching applications for phone number:', phone_number);

    // Fetch event applications with event details
    const { data: applications, error: fetchError } = await supabase
      .from('event_applications')
      .select(`
        applied_at,
        experience,
        event_create (
          id,
          event_name,
          poster_file,
          start_date,
          end_date,
          location,
          job_title,
          job_specifications,
          dress_code,
          food_provided,
          transport_provided,
          total_pay,
          additional_details,
          organizer_phone_number
        )
      `)
      .eq('phone_number', phone_number.trim());

    if (fetchError) {
      console.error('Supabase Fetch Error:', fetchError);
      return res.status(500).json({
        success: false,
        error: `Database error: ${fetchError.message}`
      });
    }

    if (!applications || applications.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No applications found for this phone number'
      });
    }

    // Filter out records where event_create is null
    const formattedApplications = applications
      .filter(application => application.event_create) // Exclude records without event_create
      .map(application => {
        const { applied_members, accepted_members, rejected_members, ...eventDetails } = application.event_create || {};
        
        return {
          applied_at: application.applied_at,
          experience: application.experience || null,
          ...eventDetails
        };
      });

    if (formattedApplications.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No valid applications found'
      });
    }

    return res.status(200).json({
      success: true,
      data: formattedApplications,
      total: formattedApplications.length
    });

  } catch (error) {
    console.error('Server Error:', error.message);
    return res.status(500).json({
      success: false,
      error: `Server error: ${error.message}`
    });
  }
});

app.post('/api/v2/events/save', async (req, res) => {
  console.log('Received body:', req.body);
  const { phone_number, event_id } = req.body;

  // 1. Validate presence
  if (!phone_number || !event_id) {
    return res.status(400).json({ success: false, error: 'Missing phone_number or event_id' });
  }

  // 2. Validate event_id (must be UUID)
  const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  if (!uuidRegex.test(event_id)) {
    return res.status(400).json({ success: false, error: 'event_id must be a valid UUID' });
  }

  // 3. Normalize and validate phone number
  let cleanPhone = phone_number.trim();
  const phoneRegex = /^\+?[1-9]\d{1,14}$/; // E.164 format
  if (!phoneRegex.test(cleanPhone)) {
    return res.status(400).json({ success: false, error: 'Invalid phone_number format' });
  }
  if (!cleanPhone.startsWith('+')) {
    cleanPhone = `+${cleanPhone}`;
  }

  try {
    console.log(`Fetching event ID: ${event_id}`);

    // 4. Fetch the event's saved field
    const { data: currentEvent, error: fetchError } = await supabase
      .from('event_create')
      .select('saved')
      .eq('id', event_id)
      .single();

    if (fetchError) {
      console.error('Supabase fetch error:', fetchError);
      return res.status(500).json({ success: false, error: 'Database fetch error' });
    }

    if (!currentEvent) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }

    // 5. Prepare updated saved list
    let updatedSaved = [];
    if (Array.isArray(currentEvent.saved)) {
      updatedSaved = [...new Set([...currentEvent.saved, cleanPhone])];
    } else {
      updatedSaved = [cleanPhone];
    }

    // 6. Update the event in Supabase
    const { data: updatedEvent, error: updateError } = await supabase
      .from('event_create')
      .update({ saved: updatedSaved })
      .eq('id', event_id)
      .select('*')
      .single();

    if (updateError) {
      console.error('Supabase update error:', updateError);
      return res.status(500).json({ success: false, error: 'Database update error' });
    }

    // 7. Send success response
    res.status(200).json({
      success: true,
      message: 'Event saved successfully',
      data: updatedEvent
    });

  } catch (error) {
    console.error('Save error:', {
      message: error.message,
      stack: error.stack,
      phone: cleanPhone,
      event_id,
      timestamp: new Date().toISOString()
    });

    res.status(500).json({
      success: false,
      error: 'Failed to save event',
      details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});


app.get('/api/v2/events/saved', async (req, res) => {
  const { phone_number } = req.query;

  // Validate phone number
  if (!phone_number || typeof phone_number !== 'string') {
    return res.status(400).json({ 
      success: false, 
      error: 'Valid phone_number is required' 
    });
  }

  // Normalize phone number
  let cleanPhone = phone_number.trim();
  const phoneRegex = /^\+?[1-9]\d{1,14}$/;
  if (!phoneRegex.test(cleanPhone)) {
    return res.status(400).json({ 
      success: false, 
      error: 'Invalid phone_number format' 
    });
  }
  if (!cleanPhone.startsWith('+')) {
    cleanPhone = `+${cleanPhone}`;
  }

  try {
    console.log('Querying saved events for phone:', cleanPhone);

    // Fetch events using RPC
    const { data: events, error: eventsError } = await supabase
      .rpc('get_saved_events', { phone_num: cleanPhone })
      .select('*, organizer_phone_number');

    if (eventsError) {
      console.error('Supabase RPC error:', eventsError);
      throw new Error(`Database fetch error: ${eventsError.message}`);
    }

    console.log('Fetched events:', events);

    if (!events || events.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
        message: 'No saved events found'
      });
    }

    // Fetch organizer details
    const organizerPhones = [...new Set(events.map(event => event.organizer_phone_number))];
    console.log('Organizer phones:', organizerPhones);

    const { data: organizers, error: orgError } = await supabase
      .from('company_registration')
      .select('phone_number, company_name, average_rating')
      .in('phone_number', organizerPhones);

    if (orgError) {
      console.error('Supabase organizer fetch error:', orgError);
      throw new Error(`Database fetch error: ${orgError.message}`);
    }

    // Create organizer map
    const organizerMap = {};
    organizers.forEach(org => {
      organizerMap[org.phone_number] = {
        company_name: org.company_name || 'Unknown',
        average_rating: org.average_rating || null
      };
    });

    // Enrich events
    const enrichedEvents = events.map(event => {
      const { applied_members, accepted_members, rejected_members, saved, saved_events, ...rest } = event;
      return {
        ...rest,
        organizer: organizerMap[event.organizer_phone_number] || { company_name: 'Unknown', average_rating: null }
      };
    });

    res.status(200).json({
      success: true,
      data: enrichedEvents,
      message: `${enrichedEvents.length} saved event${enrichedEvents.length === 1 ? '' : 's'} found`
    });
  } catch (error) {
    console.error('Fetch error:', {
      message: error.message,
      stack: error.stack,
      phone: cleanPhone,
      timestamp: new Date().toISOString()
    });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch saved events',
      details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});


app.post("/upload", upload.array("files", 5), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ success: false, message: "No files uploaded" });
        }

        const uploadedFiles = [];

        // ✅ Loop through all uploaded files
        for (const file of req.files) {
            const fileName = `${Date.now()}_${file.originalname}`;

            // ✅ Upload to Supabase Storage (Replace 'your-bucket-name' with actual bucket name)
            const { data, error } = await supabase
                .storage
                .from("uploads")  // 🔥 Replace with actual bucket name
                .upload(fileName, file.buffer, {
                    contentType: file.mimetype,
                });

            if (error) throw new Error(`Supabase Upload Error: ${error.message}`);

            // ✅ Get public URL
            const fileUrl = `${supabaseUrl}/storage/v1/object/public/uploads/${fileName}`;
            uploadedFiles.push({ fileName, fileUrl });
        }

        res.status(200).json({
            success: true,
            message: "Files uploaded successfully",
            files: uploadedFiles,
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});



app.get('/api/events/applications/:event_id/:phone_number', async (req, res) => {
  try {
    const { event_id, phone_number } = req.params;
    console.log('Fetching application for:', event_id, phone_number);

    const { data, error } = await supabase
      .from('event_applications')
      .select('*')
      .eq('event_id', event_id)
      .eq('phone_number', phone_number)
      .single();  // Fetch a single record

    if (error) {
      console.error('Supabase Fetch Error:', error);
      return res.status(500).json({ success: false, error: 'Database fetch error' });
    }

    if (!data) {
      return res.status(404).json({ success: false, error: 'Application not found' });
    }

    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('Server Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});





app.put('/api/events/update-status', async (req, res) => {
  const { phone_number, event_id, status } = req.body;

  if (!phone_number || !event_id || !status) {
    return res.status(400).json({ success: false, error: "Missing required fields." });
  }

  if (!['accepted', 'rejected'].includes(status)) {
    return res.status(400).json({ success: false, error: "Invalid status value." });
  }

  try {
    const { data, error } = await supabase
      .from('event_applications')
      .update({ status })
      .eq('phone_number', phone_number)
      .eq('event_id', event_id)
      .select('*');

    if (error) {
      console.error("Error updating status:", error.message);
      return res.status(500).json({ success: false, error: error.message });
    }

    res.status(200).json({ success: true, message: `User ${status} successfully!`, data });
  } catch (err) {
    console.error("Server error:", err.message);
    res.status(500).json({ success: false, error: "Server error occurred" });
  }
});


app.get('/api/events/accepted-users/:event_id', async (req, res) => {
  const { event_id } = req.params;

  if (!event_id) {
    return res.status(400).json({ success: false, error: "Event ID is required" });
  }

  try {
    const { data, error } = await supabase
      .from('event_applications')
      .select('phone_number, status, user1 (first_name, last_name, email, location, gender, dob)')
      .eq('event_id', event_id)
      .eq('status', 'accepted');  // Only fetch accepted users

    if (error) {
      console.error("Error fetching accepted users:", error.message);
      return res.status(500).json({ success: false, error: error.message });
    }

    res.status(200).json({ success: true, users: data });
  } catch (err) {
    console.error("Server error:", err.message);
    res.status(500).json({ success: false, error: "Server error occurred" });
  }
});

// CHAT ROOM

// ✅ API for Fetching Upcoming Events

app.get('/api/events/upcoming', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0]; // Get today's date in YYYY-MM-DD format

    // Fetch upcoming events where end_date is in the future
    const { data: upcomingEvents, error } = await supabase
      .from('event_create') // Your events table
      .select('*')
      .gt('end_date', today); // Greater than today (upcoming)

    if (error) {
      console.error('Supabase Fetch Error (upcoming events):', error);
      return res.status(500).json({ success: false, error: 'Database fetch error' });
    }

    res.status(200).json({ success: true, data: upcomingEvents });
  } catch (error) {
    console.error('Server Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ✅ API for Fetching Completed Events

app.get('/api/events/completed', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0]; // Get today's date in YYYY-MM-DD format

    // Fetch completed events where end_date is in the past
    const { data: completedEvents, error } = await supabase
      .from('event_create') // Your events table
      .select('*')
      .lte('end_date', today); // Less than or equal to today (completed)

    if (error) {
      console.error('Supabase Fetch Error (completed events):', error);
      return res.status(500).json({ success: false, error: 'Database fetch error' });
    }

    res.status(200).json({ success: true, data: completedEvents });
  } catch (error) {
    console.error('Server Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// You'll need an API to fetch details of a specific event when a user clicks on it. This API will:
// ✔ Return only event name and date
// ✔ Allow only the organizer to see Start Event and End Event buttons

app.get('/api/events/:event_id', async (req, res) => {
  try {
    const { event_id } = req.params;
    const { phone_number } = req.query;

    console.log(`Fetching event ${event_id} for phone number: ${phone_number}`);

    // Fetch event details
    const { data: event, error: eventError } = await supabase
      .from('event_create')
      .select('event_name, start_date, end_date, organizer_phone_number')
      .eq('id', event_id)
      .single();

    if (eventError) {
      console.error('Supabase Fetch Error (event_create):', eventError);
      return res.status(500).json({ success: false, error: 'Database fetch error' });
    }

    if (!event) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }

    // Ensure proper comparison of phone numbers
    const isOrganizer = event.organizer_phone_number?.trim() === phone_number.trim();

    res.status(200).json({
      success: true,
      data: {
        event_name: event.event_name,
        start_date: event.start_date,
        end_date: event.end_date,
        isOrganizer: isOrganizer
      }
    });
  } catch (error) {
    console.error('Server Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

//CHAT ROOMS
//1.  to fetch upcoming and completed events
// API-->  https://krewsup-2-0-2.onrender.com/api/chat/rooms?phone_number=8296058467


app.get('/api/chat/rooms', async (req, res) => {
  try {
    const { phone_number } = req.query;

    // Input validation
    if (!phone_number) {
      return res.status(400).json({
        success: false,
        error: 'Phone number is required',
      });
    }

    // Step 1: Fetch events where the user is the organizer or an accepted member
    const { data: allEvents, error: fetchError } = await supabase
      .from('event_create')
      .select(`
        id,
        event_name,
        organizer_phone_number,
        accepted_members,
        start_date,
        end_date,
        start_time,
        end_time,
        chat_rooms!event_create_id_fkey (id, room_name)
      `)
      .or(`organizer_phone_number.eq.${phone_number},accepted_members.cs.{${phone_number}}`);

    if (fetchError) {
      console.error('Supabase Fetch Error (all events):', fetchError);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch events',
      });
    }

    // Step 2: Filter events and create chat rooms only if payment is completed and there are accepted members
    const eventsWithChatRooms = await Promise.all(
      allEvents.map(async (event) => {
        // Check if there are accepted members
        const acceptedMembers = event.accepted_members || [];
        if (acceptedMembers.length === 0) {
          return null;
        }

        // Fetch payment status for the event
        const { data: payments, error: paymentsError } = await supabase
          .from('payments')
          .select('payment_status')
          .eq('event_id', event.id)
          .order('created_at', { ascending: false })
          .limit(1);

        if (paymentsError) {
          console.error('Error fetching payment status:', paymentsError);
          return null;
        }

        const paymentStatus =
          payments && payments.length > 0 ? payments[0].payment_status : 'pending';
        if (paymentStatus !== 'completed') {
          return null;
        }

        // If no chat room exists, create one
        let chatRoom =
          event.chat_rooms && event.chat_rooms.length > 0 ? event.chat_rooms[0] : null;

        if (!chatRoom) {
          const roomName = `${event.event_name} Chat Room`;
          const { data: newChatRoom, error: chatRoomError } = await supabase
            .from('chat_rooms')
            .insert([{ event_id: event.id, room_name: roomName }])
            .select('id, room_name')
            .single();

          if (chatRoomError) {
            console.error('Error creating chat room:', chatRoomError);
            return null;
          }
          chatRoom = newChatRoom;
        }

        return { ...event, chat_room: chatRoom };
      })
    );

    const validEvents = eventsWithChatRooms.filter(event => event !== null);

    if (!validEvents || validEvents.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No events with chat rooms found',
        data: {
          upcoming_events: [],
          completed_events: [],
        },
      });
    }

    // Step 3: Categorize events into upcoming and completed based on end_date + end_time
    const upcomingEvents = [];
    const completedEvents = [];
    const currentDate = new Date();

    validEvents.forEach(event => {
      const acceptedMembers = event.accepted_members || [];
      const totalMembers = (event.organizer_phone_number ? 1 : 0) + acceptedMembers.length;

      // Build full datetime for end time comparison
      let endDateTime = null;
      if (event.end_date && event.end_time) {
        endDateTime = new Date(`${event.end_date}T${event.end_time}`);
      } else if (event.end_date) {
        endDateTime = new Date(event.end_date);
      }

      const eventDetails = {
        id: event.id,
        room_id: event.chat_room.id,
        event_name: event.event_name || 'Unnamed Event',
        start_date: event.start_date || 'N/A',
        end_date: event.end_date || 'N/A',
        total_members: totalMembers,
        organizer_phone_number: event.organizer_phone_number || 'N/A',
        accepted_members: acceptedMembers,
      };

      // Only mark as completed if current date/time is after event's actual end time
      if (endDateTime && endDateTime.getTime() < currentDate.getTime()) {
        completedEvents.push(eventDetails);
      } else {
        upcomingEvents.push(eventDetails);
      }
    });

    // Step 4: Sort events
    upcomingEvents.sort((a, b) => {
      const dateA = a.start_date !== 'N/A' ? new Date(a.start_date) : new Date(0);
      const dateB = b.start_date !== 'N/A' ? new Date(b.start_date) : new Date(0);
      return dateA - dateB;
    });

    completedEvents.sort((a, b) => {
      const dateA = a.end_date !== 'N/A' ? new Date(a.end_date) : new Date(0);
      const dateB = b.end_date !== 'N/A' ? new Date(b.end_date) : new Date(0);
      return dateB - dateA;
    });

    // Step 5: Return the response
    res.status(200).json({
      success: true,
      message: 'Chat rooms fetched successfully',
      data: {
        upcoming_events: upcomingEvents,
        completed_events: completedEvents,
      },
    });

  } catch (error) {
    console.error('Error fetching chat rooms:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
});


// 2.  This API fetches the event name, start date, and end date for a specific event.
app.get('/api/chat/event/:event_id', async (req, res) => {
  try {
    const { event_id } = req.params;
    const { phone_number } = req.query;

    // Input validation
    if (!event_id || !phone_number) {
      return res.status(400).json({
        success: false,
        error: 'Event ID and phone number are required',
      });
    }

    // Fetch event details with associated chat room
    const { data: event, error: fetchError } = await supabase
      .from('event_create')
      .select(`
        event_name,
        start_date,
        end_date,
        organizer_phone_number,
        accepted_members,
        chat_rooms!event_create_id_fkey (id)
      `)
      .eq('id', event_id)
      .single();

    if (fetchError) {
      console.error('Supabase Fetch Error (event):', fetchError);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch event details',
      });
    }

    if (!event) {
      return res.status(404).json({
        success: false,
        error: 'Event not found',
      });
    }

    // Verify user is organizer or accepted member
    const acceptedMembers = event.accepted_members || [];
    const isAuthorized =
      event.organizer_phone_number === phone_number || acceptedMembers.includes(phone_number);

    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        error: 'You are not authorized to view this event',
      });
    }

    // Format response
    res.status(200).json({
      success: true,
      data: {
        event_name: event.event_name || 'Unnamed Event',
        start_date: event.start_date || 'N/A',
        end_date: event.end_date || 'N/A',
        room_id: event.chat_rooms && event.chat_rooms.length > 0 ? event.chat_rooms[0].id : null,
      },
    });
  } catch (error) {
    console.error('Error fetching event details:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
});



// 3.  This API fetches all messages for a chat room

// 3. This API fetches all messages for a chat room
app.get("/messages", async (req, res) => {
  const { room_id, phone_number } = req.query;

  console.log('Received request with params:', { room_id, phone_number });

  if (!room_id || !phone_number) {
    console.log('Validation failed: Missing room_id or phone_number');
    return res.status(400).json({
      success: false,
      error: "room_id and phone_number are required",
    });
  }

  const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  if (!uuidRegex.test(room_id)) {
    console.log('Validation failed: Invalid room_id format');
    return res.status(400).json({
      success: false,
      error: "Invalid room_id format. Must be a valid UUID.",
    });
  }

  const phoneRegex = /^\+?[1-9]\d{1,14}$/;
  if (!phoneRegex.test(phone_number)) {
    console.log('Validation failed: Invalid phone_number format');
    return res.status(400).json({
      success: false,
      error: "Invalid phone_number format. Must be a valid phone number with optional country code.",
    });
  }

  try {
    const { data: chatRoom, error: roomError } = await supabase
      .from('chat_rooms')
      .select(`
        event_id,
        event_create!chat_rooms_event_id_fkey (
          organizer_phone_number,
          accepted_members,
          organizer_name,
          gig_workers (name, phone_number)
        )
      `)
      .eq('id', room_id)
      .single();

    if (roomError) {
      console.error('Supabase Fetch Error (chat room):', roomError);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch chat room details',
        details: roomError.message,
      });
    }

    if (!chatRoom || !chatRoom.event_create) {
      return res.status(404).json({
        success: false,
        error: 'Chat room or associated event not found',
      });
    }

    const event = chatRoom.event_create;
    const acceptedMembers = event.accepted_members || [];
    const isAuthorized =
      event.organizer_phone_number === phone_number || acceptedMembers.includes(phone_number);

    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        error: 'You are not authorized to view messages in this chat room',
      });
    }

    const { data: messages, error: messagesError } = await supabase
      .from('chat_messages')
      .select('id, room_id, phone_number, message, timestamp')
      .eq('room_id', room_id)
      .order('timestamp', { ascending: true });

    if (messagesError) {
      console.error('Supabase Query Error:', messagesError);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch messages',
        details: messagesError.message,
      });
    }

    // Fetch company name for the organizer
    let organizerCompanyName = 'Unknown Company';
    if (event.organizer_phone_number) {
      const { data: companyData, error: companyError } = await supabase
        .from('company_registration')
        .select('company_name')
        .eq('phone_number', event.organizer_phone_number)
        .single();
      if (companyError) {
        console.error('Supabase Fetch Error (company):', companyError);
      } else if (companyData && companyData.company_name) {
        organizerCompanyName = companyData.company_name;
      }
    }

    // Fetch names for accepted members/gig workers from user1
    const memberPhones = [...new Set([...acceptedMembers, event.organizer_phone_number].filter(p => p))];
    const { data: userDetails, error: userError } = await supabase
      .from('user1')
      .select('phone_number, first_name, last_name')
      .in('phone_number', memberPhones);

    if (userError) {
      console.error('Supabase Fetch Error (user details):', userError);
    }

    // Create a map of phone numbers to full names
    const userMap = userDetails.reduce((map, user) => {
      map[user.phone_number] = `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Unknown User';
      return map;
    }, {});

    // Enrich messages with sender details
    const enrichedMessages = messages.map(msg => {
      let senderName = 'Unknown';
      let senderType = 'unknown';

      if (msg.phone_number === event.organizer_phone_number) {
        senderName = organizerCompanyName;
        senderType = 'organizer';
      } else if (userMap[msg.phone_number]) {
        senderName = userMap[msg.phone_number];
        senderType = 'gig_worker';
      }

      return {
        ...msg,
        sender_name: senderName,
        sender_type: senderType,
      };
    });

    res.status(200).json({
      success: true,
      message: enrichedMessages.length > 0 ? 'Messages fetched successfully' : 'No messages found',
      data: {
        event_name: event.event_name || 'Unnamed Event',
        event_start_date: event.start_date || 'N/A',
        messages: enrichedMessages,
      },
    });
  } catch (err) {
    console.error('Unexpected Server Error:', err);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: err.message,
    });
  }
});




// 4. This API fetches event details, including the description and selected crew members.

app.get('/api/chat/event-details/:event_id', async (req, res) => {
  try {
    const { event_id } = req.params;
    const { phone_number } = req.query;

    // Input validation
    if (!event_id || !phone_number) {
      return res.status(400).json({
        success: false,
        error: 'Event ID and phone number are required',
      });
    }

    // Fetch event details with chat room
    const { data: event, error: eventError } = await supabase
      .from('event_create')
      .select(`
        event_name,
        additional_details,
        organizer_phone_number,
        accepted_members,
        chat_rooms!event_create_id_fkey (id)
      `)
      .eq('id', event_id)
      .single();

    if (eventError) {
      console.error('Supabase Fetch Error (event):', eventError);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch event details',
      });
    }

    if (!event) {
      return res.status(404).json({
        success: false,
        error: 'Event not found',
      });
    }

    // Verify user is organizer or accepted member
    const acceptedMembers = event.accepted_members || [];
    const isAuthorized =
      event.organizer_phone_number === phone_number || acceptedMembers.includes(phone_number);

    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        error: 'You are not authorized to view this event',
      });
    }

    // Fetch crew member details
    const { data: crewMembers, error: crewError } = await supabase
      .from('user1')
      .select('phone_number, first_name, last_name, profile_pic')
      .in('phone_number', acceptedMembers);

    if (crewError) {
      console.error('Supabase Fetch Error (crew):', crewError);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch crew members',
      });
    }

    // Format response
    res.status(200).json({
      success: true,
      data: {
        event_name: event.event_name || 'Unnamed Event',
        description: event.additional_details || 'No description available',
        room_id: event.chat_rooms && event.chat_rooms.length > 0 ? event.chat_rooms[0].id : null,
        selected_crew: crewMembers.map(member => ({
          phone_number: member.phone_number,
          first_name: member.first_name || 'N/A',
          last_name: member.last_name || 'N/A',
          profile_pic: member.profile_pic || null,
        })),
      },
    });
  } catch (error) {
    console.error('Error fetching event details:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
});

//5 . Add an HTTP Endpoint for Sending Messages

// 5. Add an HTTP Endpoint for Sending Messages
app.post('/api/chat/join-and-send-message', async (req, res) => {
  try {
    const { room_id, phone_number, message } = req.body;

    if (!room_id || !phone_number || !message) {
      return res.status(400).json({
        success: false,
        error: 'room_id, phone_number, and message are required',
      });
    }

    const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    if (!uuidRegex.test(room_id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid room_id format. Must be a valid UUID.',
      });
    }

    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    if (!phoneRegex.test(phone_number)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid phone_number format. Must be a valid phone number with optional country code.',
      });
    }

    // Fetch chat room and related event
    const { data: chatRoom, error: roomError } = await supabase
      .from('chat_rooms')
      .select(`
        id,
        event_id,
        event_create!chat_rooms_event_id_fkey (
          id,
          organizer_phone_number,
          accepted_members
        )
      `)
      .eq('id', room_id)
      .single();

    if (roomError || !chatRoom) {
      return res.status(404).json({
        success: false,
        error: 'Chat room not found',
        details: roomError?.message,
      });
    }

    const event = chatRoom.event_create;
    if (!event) {
      return res.status(404).json({
        success: false,
        error: 'Associated event not found',
      });
    }

    // Verify authorization
    const acceptedMembers = event.accepted_members || [];
    const isAuthorized =
      event.organizer_phone_number === phone_number || acceptedMembers.includes(phone_number);

    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized: Only the organizer or accepted members can send messages',
      });
    }

    // Insert message
    const { data: savedMessage, error: messageError } = await supabase
      .from('chat_messages')
      .insert([{ room_id, phone_number, message }])
      .select('id, room_id, phone_number, message, timestamp')
      .single();

    if (messageError) {
      console.error('Supabase Insert Error:', messageError);
      return res.status(500).json({
        success: false,
        error: 'Failed to save message',
        details: messageError.message,
      });
    }

    // Dynamically resolve sender_name
    let senderName = 'Unknown';

    // Try to fetch from company (organizers)
    const { data: company } = await supabase
      .from('company')
      .select('company_name')
      .eq('phone_number', phone_number)
      .maybeSingle();

    if (company) {
      senderName = company.company_name;
    } else {
      // Try to fetch from gig worker (user1)
      const { data: user1 } = await supabase
        .from('user1')
        .select('first_name, last_name')
        .eq('phone_number', phone_number)
        .maybeSingle();

      if (user1) {
        senderName = `${user1.first_name} ${user1.last_name}`;
      }
    }

    // Broadcast via WebSocket
    const roomClients = rooms.get(room_id) || new Set();
    roomClients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: 'new_message',
          room_id,
          phone_number,
          sender_name: senderName,
          message,
          timestamp: savedMessage.timestamp,
        }));
      }
    });

    // Return success
    res.status(200).json({
      success: true,
      message: 'Message sent successfully',
      data: { ...savedMessage, sender_name: senderName },
    });
  } catch (error) {
    console.error('Error in join-and-send-message:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message,
    });
  }
});



// CHAT-ROOM




app.get('/api/events/applicants/:event_id', async (req, res) => {
  try {
    const { event_id } = req.params;

    // Step 1: Validate event_id
    if (!event_id) {
      return res.status(400).json({
        success: false,
        error: 'Event ID is required',
      });
    }

    // Step 2: Fetch all applicants for the event
    const { data: applicants, error: applicantsError } = await supabase
      .from('event_applications')
      .select('phone_number')
      .eq('event_id', event_id);

    if (applicantsError) {
      throw applicantsError;
    }

    if (!applicants || applicants.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No applicants found for this event',
      });
    }

    // Step 3: Fetch user details for each applicant
    const phoneNumbers = applicants.map((app) => app.phone_number);
    const { data: users, error: usersError } = await supabase
      .from('user1')
      .select('*')
      .in('phone_number', phoneNumbers); // Fetch users whose phone numbers match the applicants

    if (usersError) {
      throw usersError;
    }

    // Step 4: Return the user details
    res.status(200).json({
      success: true,
      message: 'Applicants fetched successfully',
      applicants: users,
    });
  } catch (error) {
    console.error('Error fetching applicants:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch applicants',
    });
  }
});

// Confirm ending an event
app.post('/api/events/confirm-end/:event_id', async (req, res) => {
  const { event_id } = req.params;
  const { phone_number, confirm } = req.body; // Organizer's phone number and confirmation

  if (!event_id || !phone_number || !confirm) {
    return res.status(400).json({ success: false, error: "Event ID, phone number, and confirmation are required" });
  }

  if (confirm !== 'yes') {
    return res.status(400).json({ success: false, error: "Confirmation required to end the event" });
  }

  try {
    // Verify the user is the organizer
    const {data: event, error: fetchError } = await supabase
      .from('event_create')
      .select('organizer_phone_number')
      .eq('id', event_id)
      .single();

    if (fetchError) throw fetchError;
    if (!event || event.organizer_phone_number !== phone_number) {
      return res.status(403).json({ success: false, error: "Unauthorized: Only the organizer can end this event" });
    }

    // Update event status to "ended"
    const { data, error } = await supabase
      .from('event_create')
      .update({ status: 'ended', ended_at: new Date().toISOString() })
      .eq('id', event_id)
      .select('*');

    if (error) throw error;

    // Notify all users via WebSocket that the event has ended
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: 'event_ended',
          event_id,
          message: "The event has ended"
        }));
      }
    });

    // Optionally, close the chat room or update its status
    const { error: chatError } = await supabase
      .from('chat_rooms')
      .update({ status: 'closed' })
      .eq('event_id', event_id);

    if (chatError) console.error('Error closing chat room:', chatError);

    res.status(200).json({ success: true, message: "Event ended successfully", data });
  } catch (error) {
    console.error('Error confirming end of event:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

//rating
//rating
// Helper function to update worker's average rating
async function updateWorkerRating(workerPhone) {
  // Get all ratings for this worker
  const { data: ratings, error } = await supabase
    .from('ratings')
    .select('rating')
    .eq('target_type', 'worker')
    .eq('target_id', workerPhone);

  if (error) throw error;

  const totalRatings = ratings.length;
  const sumRatings = ratings.reduce((sum, r) => sum + r.rating, 0);
  const averageRating = totalRatings > 0 ? sumRatings / totalRatings : 0;

  // Update worker's profile
  const { error: updateError } = await supabase
    .from('user1')
    .update({
      average_rating: averageRating,
      rating_count: totalRatings,
      updated_at: new Date().toISOString()
    })
    .eq('phone_number', workerPhone);

  if (updateError) throw updateError;
}

// Helper function to update company's average rating
async function updateCompanyRating(companyPhone) {
  // Get all ratings for this company
  const { data: ratings, error } = await supabase
    .from('ratings')
    .select('rating')
    .eq('target_type', 'company')
    .eq('target_id', companyPhone);

  if (error) throw error;

  const totalRatings = ratings.length;
  const sumRatings = ratings.reduce((sum, r) => sum + r.rating, 0);
  const averageRating = totalRatings > 0 ? sumRatings / totalRatings : 0;

  // Update company's profile
  const { error: updateError } = await supabase
    .from('company_registration')
    .update({
      average_rating: averageRating,
      rating_count: totalRatings,
      updated_at: new Date().toISOString()
    })
    .eq('phone_number', companyPhone);

  if (updateError) throw updateError;
}


app.post('/api/v2/ratings/worker-to-company', async (req, res) => {
  console.log('Received request body:', req.body);
  try {
    const { worker_phone, company_phone, event_id, rating, feedback } = req.body;

    // Validate input
    if (!worker_phone || !company_phone || !event_id || !rating) {
      return res.status(400).json({ 
        success: false,
        error: 'Missing required fields: worker_phone, company_phone, event_id, rating' 
      });
    }

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ 
        success: false,
        error: 'Rating must be an integer between 1 and 5' 
      });
    }

    // Verify relationship
    const { data: event, error: eventError } = await supabase
      .from('event_create')
      .select('id, organizer_phone_number, accepted_members')
      .eq('id', event_id)
      .eq('organizer_phone_number', company_phone)
      .contains('accepted_members', [worker_phone])
      .single();

    if (eventError || !event) {
      return res.status(403).json({ 
        success: false,
        error: 'You can only rate companies whose events you were accepted to' 
      });
    }

    // Check for existing rating
    const { data: existingRating } = await supabase
      .from('ratings')
      .select('id')
      .eq('rater_type', 'worker')
      .eq('rater_id', worker_phone)
      .eq('target_type', 'company')
      .eq('target_id', company_phone)
      .eq('event_id', event_id)
      .single();

    if (existingRating) {
      return res.status(409).json({ 
        success: false,
        error: 'You have already rated this company for this event' 
      });
    }

    // Insert new rating
    const { data: newRating, error: insertError } = await supabase
      .from('ratings')
      .insert([{
        rater_type: 'worker',
        rater_id: worker_phone,
        target_type: 'company',
        target_id: company_phone,
        event_id,
        rating,
        feedback
      }])
      .select()
      .single();

    if (insertError) throw insertError;

    // Update company's average rating
    await updateCompanyRating(company_phone);

    return res.status(201).json({
      success: true,
      message: 'Rating submitted successfully',
      data: newRating
    });

  } catch (error) {
    console.error('Rating error:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Failed to submit rating',
      details: error.message 
    });
  }
});

app.post('/api/v2/ratings/company-to-worker', async (req, res) => {
  try {
    const { company_phone, worker_phone, event_id, rating, feedback } = req.body;

    // Validate input
    if (!company_phone || !worker_phone || !event_id || !rating) {
      return res.status(400).json({ 
        success: false,
        error: 'Missing required fields: company_phone, worker_phone, event_id, rating' 
      });
    }

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ 
        success: false,
        error: 'Rating must be an integer between 1 and 5' 
      });
    }

    // Verify relationship
    const { data: event, error: eventError } = await supabase
      .from('event_create')
      .select('id, organizer_phone_number, accepted_members')
      .eq('id', event_id)
      .eq('organizer_phone_number', company_phone)
      .contains('accepted_members', [worker_phone])
      .single();

    if (eventError || !event) {
      return res.status(403).json({ 
        success: false,
        error: 'You can only rate workers who were accepted to your events' 
      });
    }

    // Check for existing rating
    const { data: existingRating } = await supabase
      .from('ratings')
      .select('id')
      .eq('rater_type', 'company')
      .eq('rater_id', company_phone)
      .eq('target_type', 'worker')
      .eq('target_id', worker_phone)
      .eq('event_id', event_id)
      .single();

    if (existingRating) {
      return res.status(409).json({ 
        success: false,
        error: 'You have already rated this worker for this event' 
      });
    }

    // Insert new rating
    const { data: newRating, error: insertError } = await supabase
      .from('ratings')
      .insert([{
        rater_type: 'company',
        rater_id: company_phone,
        target_type: 'worker',
        target_id: worker_phone,
        event_id,
        rating,
        feedback
      }])
      .select()
      .single();

    if (insertError) throw insertError;

    // Update worker's average rating
    await updateWorkerRating(worker_phone);

    return res.status(201).json({
      success: true,
      message: 'Rating submitted successfully',
      data: newRating
    });

  } catch (error) {
    console.error('Rating error:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Failed to submit rating',
      details: error.message 
    });
  }
});
// Start Event API
app.post('/api/events/:event_id/start', async (req, res) => {
  try {
    const { event_id } = req.params;
    const { phone_number } = req.body;

    if (!event_id || !phone_number) {
      return res.status(400).json({
        success: false,
        error: 'Event ID and phone number are required'
      });
    }

    const { data: event, error: fetchError } = await supabase
      .from('event_create')
      .select('organizer_phone_number, status')
      .eq('id', event_id)
      .single();

    if (fetchError) {
      console.error('Supabase fetch error:', fetchError.message); // Log detailed error
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch event',
        details: fetchError.message // Include error details in response
      });
    }

    if (!event) {
      return res.status(404).json({
        success: false,
        error: 'Event not found'
      });
    }

    if (event.organizer_phone_number !== phone_number) {
      return res.status(403).json({
        success: false,
        error: 'Only the organizer can start the event'
      });
    }

    if (event.status === 'started') {
      return res.status(400).json({
        success: false,
        error: 'Event has already started'
      });
    }
    if (event.status === 'ended') {
      return res.status(400).json({
        success: false,
        error: 'Event has already ended'
      });
    }

    const { data, error } = await supabase
      .from('event_create')
      .update({ status: 'started' })
      .eq('id', event_id)
      .select('*')
      .single();

    if (error) {
      console.error('Supabase update error:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Failed to start event',
        details: error.message
      });
    }

    res.status(200).json({
      success: true,
      message: 'Event started successfully',
      data
    });
  } catch (error) {
    console.error('Unexpected error starting event:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message
    });
  }
});


// End Event API
app.post('/api/events/:event_id/end', async (req, res) => {
  try {
    const { event_id } = req.params;
    const { phone_number } = req.body;

    // 1. Input Validation
    if (!event_id || !phone_number) {
      return res.status(400).json({
        success: false,
        error: 'Event ID and phone number are required'
      });
    }

    // Optional: Validate event_id format (assuming UUID)
    const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    if (!uuidRegex.test(event_id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid event ID format. Must be a valid UUID'
      });
    }

    // 2. Fetch Event Details
    const { data: event, error: fetchError } = await supabase
      .from('event_create')
      .select('id, organizer_phone_number, status, end_date')
      .eq('id', event_id)
      .single();

    if (fetchError) {
      console.error('Supabase fetch error:', fetchError.message, {
        code: fetchError.code,
        details: fetchError.details,
        hint: fetchError.hint
      });
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch event',
        details: fetchError.message
      });
    }

    if (!event) {
      return res.status(404).json({
        success: false,
        error: 'Event not found'
      });
    }

    // 3. Authorization Check
    if (event.organizer_phone_number !== phone_number) {
      return res.status(403).json({
        success: false,
        error: 'Only the organizer can end the event'
      });
    }

    // 4. Status Validation
    if (!event.status || event.status === 'pending') {
      return res.status(400).json({
        success: false,
        error: 'Event must be started before it can be ended'
      });
    }

    if (event.status === 'ended') {
      return res.status(400).json({
        success: false,
        error: 'Event has already ended'
      });
    }

    // 5. Optional: Date Validation
    const currentDate = new Date();
    const endDate = new Date(event.end_date);
    if (currentDate < endDate) {
      return res.status(400).json({
        success: false,
        error: 'Cannot end event before scheduled end date',
        scheduled_end_date: event.end_date
      });
    }

    // 6. Update Event Status
    const { data: updatedEvent, error: updateError } = await supabase
      .from('event_create')
      .update({
        status: 'ended',
        ended_at: new Date().toISOString(), // Track when it ended
        updated_at: new Date().toISOString() // Track last update
      })
      .eq('id', event_id)
      .select('*')
      .single();

    if (updateError) {
      console.error('Supabase update error:', updateError.message, {
        code: updateError.code,
        details: updateError.details,
        hint: updateError.hint
      });
      return res.status(500).json({
        success: false,
        error: 'Failed to end event',
        details: updateError.message
      });
    }

    // 7. Optional: WebSocket Notification
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: 'event_ended',
          event_id,
          message: 'The event has ended',
          timestamp: new Date().toISOString()
        }));
      }
    });

    // 8. Success Response
    res.status(200).json({
      success: true,
      message: 'Event ended successfully',
      data: updatedEvent
    });
  } catch (error) {
    console.error('Unexpected error ending event:', error.message, {
      stack: error.stack
    });
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message
    });
  }
});





//comapny-verfiy
app.patch('/api/v2/company/verify/:phone_number', async (req, res) => {
  const { phone_number } = req.params; // Get phone_number from URL path
  const { status } = req.body; // Get status from request body

  // Validate phone_number
  if (!phone_number || typeof phone_number !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'Valid phone_number is required in the URL path',
      code: 'INVALID_PHONE_NUMBER',
    });
  }

  const cleanPhone = phone_number.trim();
  const phoneRegex = /^\+?[1-9]\d{1,14}$/;
  if (!phoneRegex.test(cleanPhone)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid phone_number format in URL path',
      code: 'INVALID_PHONE_NUMBER_FORMAT',
    });
  }

  // Validate status
  if (!status || typeof status !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'Valid status is required in the request body',
      code: 'INVALID_STATUS',
    });
  }

  const allowedStatuses = ['verified', 'not-verified_eliminate'];
  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({
      success: false,
      error: `Invalid status. Must be one of: ${allowedStatuses.join(', ')}`,
      code: 'INVALID_STATUS_VALUE',
    });
  }

  try {
    // Retry logic for Supabase queries with exponential backoff
    const queryWithRetry = async (queryFn, retries = 3, baseDelay = 1000) => {
      for (let i = 0; i < retries; i++) {
        try {
          const { data, error } = await queryFn();
          if (error) throw error;
          return { data, error: null };
        } catch (error) {
          if (i < retries - 1) {
            const delay = baseDelay * Math.pow(2, i); // Exponential backoff
            console.warn(`[${new Date().toISOString()}] Retry ${i + 1}/${retries} for Supabase query (delay: ${delay}ms):`, error.message);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
          return { data: null, error };
        }
      }
    };

    // Update company_status with retry
    const { data: updatedCompany, error: updateError } = await queryWithRetry(() =>
      supabase
        .from('company_registration')
        .update({ company_status: status })
        .eq('phone_number', cleanPhone)
        .select('phone_number, company_name, average_rating, company_status, account_number')
        .single()
    );

    if (updateError) {
      console.error(`[${new Date().toISOString()}] Supabase Update Error:`, JSON.stringify(updateError, null, 2));
      const errorObj = new Error(`Failed to update company: ${updateError.message}`);
      errorObj.supabaseError = updateError;
      throw errorObj;
    }

    if (!updatedCompany) {
      return res.status(404).json({
        success: false,
        error: 'Company not found',
        code: 'COMPANY_NOT_FOUND',
      });
    }

    // Parse account_number to integer
    const accountNumberInt = Math.round(parseFloat(updatedCompany.account_number) || 0);

    // Fetch associated events with retry
    const { data: events, error: eventsError } = await queryWithRetry(() =>
      supabase
        .from('event_create')
        .select('event_name, start_date, end_date')
        .eq('organizer_phone_number', cleanPhone)
    );

    if (eventsError) {
      console.error(`[${new Date().toISOString()}] Supabase Events Error:`, JSON.stringify(eventsError, null, 2));
      const errorObj = new Error(`Failed to fetch events: ${eventsError.message}`);
      errorObj.supabaseError = eventsError;
      throw errorObj;
    }

    // Prepare response with updated company and organizer event details
    const responseData = {
      company: {
        phone_number: updatedCompany.phone_number,
        company_name: updatedCompany.company_name || 'Unknown',
        average_rating: updatedCompany.average_rating || null,
        company_status: updatedCompany.company_status,
        account_number: accountNumberInt, // Integer
      },
      organizer_events: events.map(event => ({
        event_name: event.event_name || 'Unnamed Event',
        start_date: event.start_date || 'N/A',
        end_date: event.end_date || 'N/A',
      })),
    };

    res.status(200).json({
      success: true,
      message: `Company status updated to ${status}`,
      data: responseData,
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Verification error:`, JSON.stringify(error, null, 2));
    res.status(500).json({
      success: false,
      error: 'Failed to update company status',
      code: 'INTERNAL_ERROR',
      details: process.env.NODE_ENV === 'development' ? { message: error.message, stack: error.stack, supabaseError: error.supabaseError || null } : 'Internal server error',
    });
  }
});

app.put("/api/update-event/:eventId", async (req, res) => {
  try {
    const { eventId } = req.params;
    const updates = req.body;

    // 1. Fetch the event
    const { data: event, error } = await supabase
      .from("event_create")
      .select("*")
      .eq("id", eventId)
      .single();

    if (error || !event) {
      return res.status(404).json({
        success: false,
        error: "Event not found"
      });
    }

    // 2. Restrict if accepted_members exist
    if (event.accepted_members && event.accepted_members.length > 0) {
      return res.status(400).json({
        success: false,
        error: "Event cannot be updated because members have already accepted."
      });
    }

    // 3. Restrict if within 3 days
    const today = new Date();
    const startDate = new Date(event.start_date);
    const diffDays = Math.ceil((startDate - today) / (1000 * 60 * 60 * 24));

    if (diffDays < 3) {
      return res.status(400).json({
        success: false,
        error: "Event cannot be updated within 3 days of its start date."
      });
    }

    // 4. Apply partial updates
    const { data: updatedEvent, error: updateError } = await supabase
      .from("event_create")
      .update(updates)
      .eq("id", eventId)
      .select();

    if (updateError) {
      return res.status(500).json({
        success: false,
        error: updateError.message
      });
    }

    res.json({
      success: true,
      message: "Event updated successfully",
      data: updatedEvent
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});


app.get('/api/v2/company/verification-status', async (req, res) => {
  const { phone_number } = req.query;

  // Validate inputs
  if (!phone_number || typeof phone_number !== 'string') {
    return res.status(200).json({ 
      success: true,
      message: 'Company verification status: not-verified (missing or invalid phone_number)',
      data: {
        phone_number: null,
        company_name: 'Unknown',
        is_verified: false,
        company_status: 'not-verified'
      }
    });
  }

  const cleanPhone = phone_number.trim();
  const phoneRegex = /^\+?[1-9]\d{1,14}$/;
  if (!phoneRegex.test(cleanPhone)) {
    return res.status(200).json({ 
      success: true,
      message: 'Company verification status: not-verified (invalid phone_number format)',
      data: {
        phone_number: cleanPhone,
        company_name: 'Unknown',
        is_verified: false,
        company_status: 'not-verified'
      }
    });
  }

  try {
    // Fetch company details including company_status
    const { data: company, error: fetchError } = await supabase
      .from('company_registration')
      .select('phone_number, company_name, company_status')
      .eq('phone_number', cleanPhone)
      .single();

    if (fetchError) throw fetchError;
    if (!company) {
      return res.status(200).json({
        success: true,
        message: 'Company verification status: not-verified (company not found)',
        data: {
          phone_number: cleanPhone,
          company_name: 'Unknown',
          is_verified: false,
          company_status: 'not-verified'
        }
      });
    }

    // Prepare response for a found company
    const isVerified = company.company_status === 'verified';
    const responseData = {
      phone_number: company.phone_number,
      company_name: company.company_name || 'Unknown',
      is_verified: isVerified,
      company_status: company.company_status || 'not-verified'
    };

    res.status(200).json({
      success: true,
      message: `Company verification status: ${company.company_status}`,
      data: responseData
    });
  } catch (error) {
    console.error('Verification status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch verification status',
      details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

app.get('/api/v2/company/not-verified-members', async (req, res) => {
  try {
    // Fetch all companies with company_status 'not-verified'
    const { data: companies, error } = await supabase
      .from('company_registration')
      .select(`phone_number, company_name, company_status, average_rating,
               account_number, gst_number, contact_person_name, email_id,
               ifsc_code, bank_name, company_profile`)
      .eq('company_status', 'not-verified');

    if (error) throw error;

    if (!companies || companies.length === 0) {
      return res.status(200).json({
        success: true,
        count: 0,
        message: 'No not-verified members found',
        data: []
      });
    }

    res.status(200).json({
      success: true,
      count: companies.length,
      message: `${companies.length} not-verified members found`,
      data: companies
    });
  } catch (error) {
    console.error('Error fetching not-verified members:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch not-verified members',
      details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

//payment transaction
//payment
const razorpay = new Razorpay({
  key_id: 'rzp_live_R5VXapUBFRdUJY',
  key_secret: 'WJ3CZ21uqyMo59MaCGyA7qaY'
});

// -------------------- CREATE ORDER API --------------------
app.post('/api/create-order', async (req, res) => {
    const { amount, currency, event_id } = req.body;

    if (!amount || !currency || !event_id) {
        return res.status(400).json({ error: 'amount, currency, and event_id are required' });
    }

    try {
        const options = {
            amount: amount * 100,             // 💰 Amount in paise (e.g., 50000 = ₹500)
            currency,                   // 🪙 Currency (e.g., INR)
            receipt: event_id,          // 📄 Reference to your event
            payment_capture: 1          // ✅ Auto-capture
        };

        const order = await razorpay.orders.create(options);

        // return minimal fields instead of full object
        res.json({
            success: true,
            orderId: order.id,          // ⚡ Razorpay Order ID
            amount: order.amount,
            currency: order.currency,
            receipt: order.receipt
        });
    } catch (error) {
        console.error('Order creation failed:', error);
        res.status(500).json({ error: 'Order creation failed', details: error.message });
    }
});


app.post('/api/payments', async (req, res) => {
  try {
    // 1. Destructure and validate input
    const { payment_status, payment_id, event_id, organizer_phone_number } = req.body;

    // Validate required fields
    const requiredFields = {
      payment_status: 'Payment status',
      payment_id: 'Payment ID',
      event_id: 'Event ID',
      organizer_phone_number: 'Organizer phone number',
    };

    const missingFields = Object.entries(requiredFields)
      .filter(([field]) => !req.body[field])
      .map(([_, name]) => name);

    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Missing required fields: ${missingFields.join(', ')}`,
        code: 'MISSING_FIELDS',
      });
    }

    // Validate payment_status
    const validStatuses = ['pending', 'completed', 'failed', 'refunded'];
    if (!validStatuses.includes(payment_status)) {
      return res.status(400).json({
        success: false,
        error: `Invalid payment status. Must be one of: ${validStatuses.join(', ')}`,
        code: 'INVALID_PAYMENT_STATUS',
      });
    }

    // Validate event_id format (UUID)
    const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    if (!uuidRegex.test(event_id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid event ID format. Must be a valid UUID',
        code: 'INVALID_EVENT_ID',
      });
    }

    // Validate phone number format
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    if (!phoneRegex.test(organizer_phone_number)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid phone number format',
        code: 'INVALID_PHONE_NUMBER',
      });
    }

    // 2. Verify event exists and organizer matches
    const { data: event, error: eventError } = await supabase
      .from('event_create')
      .select('id, organizer_phone_number')
      .eq('id', event_id)
      .single();

    if (eventError || !event) {
      return res.status(404).json({
        success: false,
        error: 'Event not found',
        code: 'EVENT_NOT_FOUND',
        details: eventError?.message,
      });
    }

    if (event.organizer_phone_number !== organizer_phone_number) {
      return res.status(403).json({
        success: false,
        error: 'Organizer phone number does not match event organizer',
        code: 'UNAUTHORIZED',
      });
    }

    // 3. Check for duplicate payment_id
    const { data: existingPayment, error: paymentCheckError } = await supabase
      .from('payments')
      .select('payment_id')
      .eq('payment_id', payment_id)
      .single();

    if (existingPayment) {
      return res.status(409).json({
        success: false,
        error: 'Payment ID already exists',
        code: 'DUPLICATE_PAYMENT_ID',
      });
    }

    if (paymentCheckError && paymentCheckError.code !== 'PGRST116') {
      return res.status(500).json({
        success: false,
        error: 'Failed to check payment ID',
        code: 'DATABASE_ERROR',
        details: paymentCheckError.message,
      });
    }

    // 4. Insert payment record
    const { data: payment, error: insertError } = await supabase
      .from('payments')
      .insert([
        {
          payment_status,
          payment_id,
          event_id,
          organizer_phone_number,
        },
      ])
      .select('*')
      .single();

    if (insertError) {
      console.error('Supabase Insert Error:', insertError);
      return res.status(500).json({
        success: false,
        error: 'Failed to store payment details',
        code: 'DATABASE_ERROR',
        details: insertError.message,
      });
    }

    // 5. Success response
    res.status(201).json({
      success: true,
      message: 'Data successfully stored',
      data: payment,
    });
  } catch (error) {
    console.error('Unexpected Error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
      details: error.message,
    });
  }
});  


// app.get('/api/payments/:event_id/status', async (req, res) => {
//   try {
//     const { event_id } = req.params;

//     // Validate event_id
//     if (!event_id) {
//       return res.status(400).json({
//         success: false,
//         error: 'Event ID is required',
//         code: 'MISSING_EVENT_ID',
//       });
//     }

//     // Validate event_id format (UUID)
//     const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
//     if (!uuidRegex.test(event_id)) {
//       return res.status(400).json({
//         success: false,
//         error: 'Invalid event ID format. Must be a valid UUID',
//         code: 'INVALID_EVENT_ID',
//       });
//     }

//     // Fetch event details
//     const { data: event, error: eventError } = await supabase
//       .from('event_create')
//       .select('id, event_name, male_crew, female_crew, male_crew_pay, female_crew_pay, location, start_date, end_date')
//       .eq('id', event_id)
//       .single();

//     if (eventError || !event) {
//       return res.status(404).json({
//         success: false,
//         error: 'Event not found',
//         code: 'EVENT_NOT_FOUND',
//         details: eventError?.message,
//       });
//     }

//     // Fetch payment details for the event
//     const { data: payments, error: paymentError } = await supabase
//       .from('payments')
//       .select('payment_id, payment_status, organizer_phone_number, created_at')
//       .eq('event_id', event_id);

//     if (paymentError) {
//       console.error('Error fetching payments:', paymentError);
//       return res.status(500).json({
//         success: false,
//         error: 'Failed to fetch payment details',
//         code: 'DATABASE_ERROR',
//         details: paymentError.message,
//       });
//     }

//     // Calculate gig_worker count and total_pay
//     const gig_worker = (event.male_crew || 0) + (event.female_crew || 0);
//     const maleCrewCost = (event.male_crew || 0) * (event.male_crew_pay || 0);
//     const femaleCrewCost = (event.female_crew || 0) * (event.female_crew_pay || 0);
//     const subtotal = maleCrewCost + femaleCrewCost;
    
//     // Calculate number of days (inclusive)
//     const startDate = new Date(event.start_date);
//     const endDate = new Date(event.end_date);
//     const numberOfDays = event.start_date && event.end_date ? differenceInDays(endDate, startDate) + 1 : 1;
    
//     // Update total_pay formula to include number of days
//     const total_pay = subtotal * 1.13 * numberOfDays;

//     res.status(200).json({
//       success: true,
//       message: payments.length > 0 ? 'Payment status retrieved successfully' : 'No payments found for this event',
//       data: {
//         event_id: event.id,
//         event_name: event.event_name,
//         gig_worker,
//         location: event.location || null,
//         start_date: event.start_date || null,
//         end_date: event.end_date || null,
//         total_pay: Number(total_pay.toFixed(2)),
//         male_pay: event.male_crew_pay || 0,
//         female_pay: event.female_crew_pay || 0,
//         payments: payments.map(payment => ({
//           payment_id: payment.payment_id,
//           payment_status: payment.payment_status,
//           organizer_phone_number: payment.organizer_phone_number,
//           created_at: payment.created_at,
//         })),
//       },
//     });
//   } catch (error) {
//     console.error('Unexpected Error:', error);
//     res.status(500).json({
//       success: false,
//       error: 'Internal server error',
//       code: 'INTERNAL_ERROR',
//       details: error.message,
//     });
//   }
// });




app.get('/api/payments/:event_id/status', async (req, res) => {
  try {
    const { event_id } = req.params;

    // Validate event_id
    if (!event_id) {
      return res.status(400).json({
        success: false,
        error: 'Event ID is required',
        code: 'MISSING_EVENT_ID',
      });
    }

    // Validate event_id format (UUID)
    const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    if (!uuidRegex.test(event_id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid event ID format. Must be a valid UUID',
        code: 'INVALID_EVENT_ID',
      });
    }

    // Fetch event details
    const { data: event, error: eventError } = await supabase
      .from('event_create')
      .select('id, event_name, male_crew, female_crew, male_crew_pay, female_crew_pay, location, start_date, end_date')
      .eq('id', event_id)
      .single();

    if (eventError || !event) {
      return res.status(404).json({
        success: false,
        error: 'Event not found',
        code: 'EVENT_NOT_FOUND',
        details: eventError?.message,
      });
    }

    // Fetch payment details for the event
    const { data: payments, error: paymentError } = await supabase
      .from('payments')
      .select('payment_id, payment_status, organizer_phone_number, created_at')
      .eq('event_id', event_id);

    if (paymentError) {
      console.error('Error fetching payments:', paymentError);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch payment details',
        code: 'DATABASE_ERROR',
        details: paymentError.message,
      });
    }

    // Calculate gig_worker count and total_pay
    const gig_worker = (event.male_crew || 0) + (event.female_crew || 0);
    const maleCrewCost = (event.male_crew || 0) * (event.male_crew_pay || 0);
    const femaleCrewCost = (event.female_crew || 0) * (event.female_crew_pay || 0);
    const subtotal = maleCrewCost + femaleCrewCost;
    
    // Calculate number of days (inclusive)
    const startDate = new Date(event.start_date);
    const endDate = new Date(event.end_date);
    const numberOfDays = event.start_date && event.end_date ? differenceInDays(endDate, startDate) + 1 : 1;
    
    // Update total_pay formula to include number of days
    const total_pay = subtotal * 1.13 * numberOfDays;

    res.status(200).json({
      success: true,
      message: payments.length > 0 ? 'Payment status retrieved successfully' : 'No payments found for this event',
      data: {
        event_id: event.id,
        event_name: event.event_name,
        gig_worker,
        location: event.location || null,
        start_date: event.start_date || null,
        end_date: event.end_date || null,
        total_pay: Number(total_pay.toFixed(2)),
        male_pay: event.male_crew_pay || 0,
        female_pay: event.female_crew_pay || 0,
        payments: payments.map(payment => ({
          payment_id: payment.payment_id,
          payment_status: payment.payment_status,
          organizer_phone_number: payment.organizer_phone_number,
          created_at: payment.created_at,
        })),
      },
    });
  } catch (error) {
    console.error('Unexpected Error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
      details: error.message,
    });
  }
});

app.get('/api/organizer/:phone_number/transactions', async (req, res) => {
  try {
    const { phone_number } = req.params;

    // Validate phone number format
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    if (!phoneRegex.test(phone_number)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid phone number format',
        code: 'INVALID_PHONE_NUMBER',
      });
    }

    // Fetch payments for the organizer
    const { data: payments, error: paymentsError } = await supabase
      .from('payments')
      .select('payment_id, payment_status, event_id, created_at')
      .eq('organizer_phone_number', phone_number)
      .order('created_at', { ascending: false });

    if (paymentsError) {
      console.error('Error fetching payments:', paymentsError);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch transactions',
        code: 'DATABASE_ERROR',
        details: paymentsError.message,
      });
    }

    if (!payments || payments.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No transactions found for this organizer',
        transactions: [],
      });
    }

    // Fetch event details for all event_ids
    const eventIds = payments.map(p => p.event_id);
    const { data: events, error: eventsError } = await supabase
      .from('event_create')
      .select('id, event_name, male_crew, female_crew, male_crew_pay, female_crew_pay, location, start_date, end_date')
      .in('id', eventIds);

    if (eventsError) {
      console.error('Error fetching events:', eventsError);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch event details',
        code: 'DATABASE_ERROR',
        details: eventsError.message,
      });
    }

    // Enrich payments with event details
    const enrichedTransactions = payments.map(payment => {
      const event = events.find(e => e.id === payment.event_id) || {};
      // Calculate total_need_pay with number of days
      const maleCrewCost = (event.male_crew || 0) * (event.male_crew_pay || 0);
      const femaleCrewCost = (event.female_crew || 0) * (event.female_crew_pay || 0);
      const subtotal = maleCrewCost + femaleCrewCost;
      
      // Calculate number of days (inclusive)
      const startDate = new Date(event.start_date);
      const endDate = new Date(event.end_date);
      const numberOfDays = event.start_date && event.end_date ? differenceInDays(endDate, startDate) + 1 : 1;
      
      // Update total_need_pay formula to include number of days
      const total_need_pay = subtotal * 1.13 * numberOfDays;
      
      // Calculate gig_worker
      const gig_worker = (event.male_crew || 0) + (event.female_crew || 0);

      return {
        payment_id: payment.payment_id,
        payment_status: payment.payment_status,
        event_id: payment.event_id,
        event_details: {
          event_name: event.event_name || 'Unknown Event',
          male_crew: event.male_crew || 0,
          female_crew: event.female_crew || 0,
          male_crew_pay: event.male_crew_pay || 0,
          female_crew_pay: event.female_crew_pay || 0,
          total_need_pay: Number(total_need_pay.toFixed(2)),
          gig_worker,
          location: event.location || null,
          start_date: event.start_date || null,
          end_date: event.end_date || null,
        },
        created_at: payment.created_at,
      };
    });

    res.status(200).json({
      success: true,
      message: 'Transactions retrieved successfully',
      transactions: enrichedTransactions,
    });
  } catch (error) {
    console.error('Unexpected Error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
      details: error.message,
    });
  }
});


app.get('/api/gigworker/:phone_number/transactions', async (req, res) => {
  try {
    const { phone_number } = req.params;

    // Validate phone number format
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    if (!phoneRegex.test(phone_number)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid phone number format',
        code: 'INVALID_PHONE_NUMBER',
      });
    }

    // Fetch events where the gigworker is an accepted member
    const { data: events, error: eventsError } = await supabase
      .from('event_create')
      .select('id, event_name, accepted_members, male_crew, female_crew, male_crew_pay, female_crew_pay, location, start_date, end_date')
      .contains('accepted_members', [phone_number]);

    if (eventsError) {
      console.error('Error fetching events:', eventsError);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch events',
        code: 'DATABASE_ERROR',
        details: eventsError.message,
      });
    }

    if (!events || events.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No transactions found for this gigworker',
        transactions: [],
      });
    }

    // Fetch payments for the events
    const eventIds = events.map(e => e.id);
    const { data: payments, error: paymentsError } = await supabase
      .from('payments')
      .select('payment_id, payment_status, event_id, created_at')
      .in('event_id', eventIds)
      .order('created_at', { ascending: false });

    if (paymentsError) {
      console.error('Error fetching payments:', paymentsError);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch transactions',
        code: 'DATABASE_ERROR',
        details: paymentsError.message,
      });
    }

    // Enrich payments with event details
    const enrichedTransactions = payments.map(payment => {
      const event = events.find(e => e.id === payment.event_id) || {};
      // Calculate total_need_pay with number of days
      const maleCrewCost = (event.male_crew || 0) * (event.male_crew_pay || 0);
      const femaleCrewCost = (event.female_crew || 0) * (event.female_crew_pay || 0);
      const subtotal = maleCrewCost + femaleCrewCost;
      
      // Calculate number of days (inclusive)
      const startDate = new Date(event.start_date);
      const endDate = new Date(event.end_date);
      const numberOfDays = event.start_date && event.end_date ? differenceInDays(endDate, startDate) + 1 : 1;
      
      // Update total_need_pay formula to include number of days and ensure double
      const total_need_pay = parseFloat((subtotal * 1.13 * numberOfDays).toFixed(2));
      
      // Calculate gig_worker
      const gig_worker = (event.male_crew || 0) + (event.female_crew || 0);

      return {
        payment_id: payment.payment_id,
        payment_status: payment.payment_status,
        event_id: payment.event_id,
        event_details: {
          event_name: event.event_name || 'Unknown Event',
          male_crew: event.male_crew || 0,
          female_crew: event.female_crew || 0,
          male_crew_pay: event.male_crew_pay || 0,
          female_crew_pay: event.female_crew_pay || 0,
          total_need_pay, // Now consistently a double with two decimal places
          gig_worker,
          location: event.location || null,
          start_date: event.start_date || null,
          end_date: event.end_date || null,
        },
        created_at: payment.created_at,
      };
    });

    res.status(200).json({
      success: true,
      message: 'Transactions retrieved successfully',
      transactions: enrichedTransactions,
    });
  } catch (error) {
    console.error('Unexpected Error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
      details: error.message,
    });
  }
});
app.post('/fcm/register/gig-worker', async (req, res) => {
  const { phone_number, fcm_token } = req.body;

  try {
    // Save fcm_token in user1 as a string
    const { error: userError } = await queryWithRetry(() =>
      supabase
        .from('user1')
        .upsert({
          phone_number: phone_number,
          fcm_token: String(fcm_token)
        }, { onConflict: 'phone_number' })
    );

    if (userError) {
      console.error(`[${new Date().toISOString()}] Supabase User Error:`, JSON.stringify(userError, null, 2));
      throw new Error(`Failed to save fcm_token in user1: ${userError.message}`);
    }

    res.status(200).json({
      success: true,
      message: 'FCM token registered for gig worker',
      data: { phone_number }
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Registration error (gig-worker):`, JSON.stringify(error, null, 2));
    res.status(500).json({
      success: false,
      error: 'Failed to register FCM token for gig worker',
      code: 'INTERNAL_ERROR',
      details: process.env.NODE_ENV === 'development' ? { message: error.message, stack: error.stack } : 'Internal server error'
    });
  }
});

// POST /fcm/register/company
app.post('/fcm/register/company', async (req, res) => {
  const { phone_number, fcm_token } = req.body;

  try {
    // Check if phone_number exists in company_registration
    const { data: existingRecord, error: selectError } = await queryWithRetry(() =>
      supabase
        .from('company_registration')
        .select('phone_number')
        .eq('phone_number', phone_number)
        .single()
    );

    if (selectError || !existingRecord) {
      console.error(`[${new Date().toISOString()}] Supabase Select Error:`, JSON.stringify(selectError, null, 2));
      return res.status(404).json({
        success: false,
        error: 'Phone number not found in company_registration',
        code: 'NOT_FOUND'
      });
    }

    // Update fcm_token for the matching phone_number
    const { error: updateError } = await queryWithRetry(() =>
      supabase
        .from('company_registration')
        .update({ fcm_token: String(fcm_token) })
        .eq('phone_number', phone_number)
    );

    if (updateError) {
      console.error(`[${new Date().toISOString()}] Supabase Update Error:`, JSON.stringify(updateError, null, 2));
      throw new Error(`Failed to update fcm_token in company_registration: ${updateError.message}`);
    }

    res.status(200).json({
      success: true,
      message: 'FCM token updated for company',
      data: { phone_number }
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Registration error (company):`, JSON.stringify(error, null, 2));
    res.status(500).json({
      success: false,
      error: 'Failed to update FCM token for company',
      code: 'INTERNAL_ERROR',
      details: process.env.NODE_ENV === 'development' ? { message: error.message, stack: error.stack } : 'Internal server error'
    });
  }
});
// PATCH /fcm/verify/gig-worker
app.patch('/fcm/verify/gig-worker', async (req, res) => {
  const { phone_number, fcm_token } = req.body;

  try {
    // Update fcm_token in user1 as a string
    const { error: userError } = await queryWithRetry(() =>
      supabase
        .from('user1')
        .upsert({
          phone_number: phone_number,
          fcm_token: String(fcm_token)
        }, { onConflict: 'phone_number' })
    );

    if (userError) {
      console.error(`[${new Date().toISOString()}] Supabase User Error:`, JSON.stringify(userError, null, 2));
      throw new Error(`Failed to update fcm_token in user1: ${userError.message}`);
    }

    res.status(200).json({
      success: true,
      message: 'FCM token updated for gig worker',
      data: { phone_number }
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] FCM token update error (gig-worker):`, JSON.stringify(error, null, 2));
    res.status(500).json({
      success: false,
      error: 'Failed to update FCM token for gig worker',
      code: 'INTERNAL_ERROR',
      details: process.env.NODE_ENV === 'development' ? { message: error.message, stack: error.stack } : 'Internal server error'
    });
  }
});

// PATCH /fcm/verify/company
app.patch('/fcm/verify/company', async (req, res) => {
  const { phone_number, fcm_token } = req.body;

  try {
    // Check if phone_number exists in company_registration
    const { data: existingRecord, error: selectError } = await queryWithRetry(() =>
      supabase
        .from('company_registration')
        .select('phone_number')
        .eq('phone_number', phone_number)
        .single()
    );

    if (selectError || !existingRecord) {
      console.error(`[${new Date().toISOString()}] Supabase Select Error:`, JSON.stringify(selectError, null, 2));
      return res.status(404).json({
        success: false,
        error: 'Phone number not found in company_registration',
        code: 'NOT_FOUND'
      });
    }

    // Update fcm_token for the matching phone_number
    const { error: updateError } = await queryWithRetry(() =>
      supabase
        .from('company_registration')
        .update({ fcm_token: String(fcm_token) })
        .eq('phone_number', phone_number)
    );

    if (updateError) {
      console.error(`[${new Date().toISOString()}] Supabase Update Error:`, JSON.stringify(updateError, null, 2));
      throw new Error(`Failed to update fcm_token in company_registration: ${updateError.message}`);
    }

    res.status(200).json({
      success: true,
      message: 'FCM token updated for company',
      data: { phone_number }
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] FCM token update error (company):`, JSON.stringify(error, null, 2));
    res.status(500).json({
      success: false,
      error: 'Failed to update FCM token for company',
      code: 'INTERNAL_ERROR',
      details: process.env.NODE_ENV === 'development' ? { message: error.message, stack: error.stack } : 'Internal server error'
    });
  }
});

app.post('/api/remove-application', async (req, res) => {
  try {
    const { eventId, phoneNumber } = req.body;

    if (!eventId || !phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: eventId, phoneNumber',
      });
    }

    // 1. Fetch application (to get image URLs before deleting)
    const { data: application, error: fetchAppError } = await supabase
      .from('event_applications')
      .select('id, images')
      .eq('event_id', eventId)
      .eq('phone_number', phoneNumber)
      .single();

    if (fetchAppError) {
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch application.',
        details: fetchAppError.message,
      });
    }

    // 2. Delete images from Supabase Storage (if any)
    if (application?.images?.length) {
      const fileNames = application.images.map(url => {
        // Extract file name from the URL
        const parts = url.split('/');
        return parts[parts.length - 1];
      });

      const { error: storageError } = await supabase.storage
        .from('event_uploads')
        .remove(fileNames);

      if (storageError) {
        console.error('Storage Deletion Error:', storageError.message);
        // Not throwing here so DB cleanup still happens
      }
    }

    // 3. Remove phoneNumber from applied_members in event_create
    const { data: eventData } = await supabase
      .from('event_create')
      .select('applied_members')
      .eq('id', eventId)
      .single();

    const updatedMembers = (eventData?.applied_members || []).filter(
      member => member !== phoneNumber
    );

    await supabase
      .from('event_create')
      .update({ applied_members: updatedMembers })
      .eq('id', eventId);

    // 4. Delete application record
    const { error: deleteError } = await supabase
      .from('event_applications')
      .delete()
      .eq('event_id', eventId)
      .eq('phone_number', phoneNumber);

    if (deleteError) {
      return res.status(500).json({
        success: false,
        error: 'Failed to delete application.',
        details: deleteError.message,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Application and images removed successfully.',
    });
  } catch (err) {
    console.error('Server Error:', err);
    return res.status(500).json({
      success: false,
      error: 'Server error occurred.',
      details: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error',
    });
  }
});


const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});