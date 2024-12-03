const express = require('express');
const http = require('http');
const ejs = require('ejs');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const path = require('path');
const shortid = require('shortid');
const socketIO = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);
const SECRET_KEY = 'your_secret_key';

app.set('view engine', 'ejs');

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use('/views', express.static(path.join(__dirname, 'views')));

mongoose
  .connect('mongodb://127.0.0.1:27017/chatapp')
  .then(() => console.log('DB connected'))
  .catch((err) => console.log('Error:', err));

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  id: { type: String, required: true, unique: true, default: shortid.generate },
});

const User = mongoose.model('User', userSchema);

const messageSchema = new mongoose.Schema({
  from: { type: String, required: true },
  to: { type: String, required: true },
  content: { type: String, required: true },
});

const Message = mongoose.model('Message', messageSchema);

function authenticateToken(req, res, next) {
  const token = req.cookies.auth_token;
  if (!token) return res.redirect('/signin');

  try {
    const verified = jwt.verify(token, SECRET_KEY);
    req.user = verified;
    next();
  } catch (err) {
    res.clearCookie('auth_token');
    res.redirect('/signin');
  }
}

// Utility function to fetch all users
async function fetchAllUsers() {
  return await User.find({});
}

// Socket.IO connection
// Socket.IO connection
io.on('connection', (socket) => {
  console.log('A user connected');

  // Listen for new messages
  socket.on('message', async (msgData) => {
    try {
      const { from, to, content } = msgData;
      const newMessage = await Message.create({ from, to, content });

      // Emit the message to the receiver
      socket.broadcast.emit('message', newMessage);

      // Emit the message back to the sender as well
      socket.emit('message', newMessage);

    } catch (err) {
      console.error('Error saving message:', err);
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected');
  });
});


app.get('/', authenticateToken, async (req, res) => {
  const searchQuery = req.query.search || '';

  // Fetch all users excluding the logged-in user
  const allUsers = await User.find({ username: { $ne: req.user.username } }).exec();

  // Get users that the logged-in user has interacted with
  const chattedWithUsers = await Message.aggregate([
    { $match: { $or: [{ from: req.user.username }, { to: req.user.username }] } },
    { $group: { _id: { $cond: [{ $eq: ["$from", req.user.username] }, "$to", "$from"] } } },
    { $project: { _id: 0, username: "$_id" } }
  ]);

  // Extract only the usernames
  const usersChattedWith = chattedWithUsers.map(user => user.username);

  // Declare userID array to store user objects
  const userID = [];

  for (const user of usersChattedWith) {
    try {
      const userObj = await User.findOne({ username: user }).exec();
      if (userObj) {
        userID.push(userObj); // Add user object to the array
      }
    } catch (err) {
      console.error(`Error fetching user with username ${user}:`, err);
    }
  }

  res.render('home', {
    allUsers,
    usersChattedWith,
    dedUser: {},
    messages: [],
    loggedInUser: req.user.username,
    userID // Pass the array of user objects
  });
});


app.get('/chat/:id', authenticateToken, async (req, res) => {
  try {
    const dedUser = await User.findOne({ id: req.params.id });
    if (!dedUser) return res.status(404).send('User not found');

    const allUsers = await fetchAllUsers();
    const messages = await Message.find({
      $or: [
        { from: req.user.username, to: dedUser.username },
        { from: dedUser.username, to: req.user.username },
      ],
    }).sort({ _id: 1 });

    // Get users that the logged-in user has interacted with
    const chattedWithUsers = await Message.aggregate([
      { $match: { $or: [{ from: req.user.username }, { to: req.user.username }] } },
      { $group: { _id: { $cond: [{ $eq: ["$from", req.user.username] }, "$to", "$from"] } } },
      { $project: { _id: 0, username: "$_id" } }
    ]);

    // Extract only the usernames
    const usersChattedWith = chattedWithUsers.map(user => user.username);

    const userID = [];

    for (const user of usersChattedWith) {
      try {
        const userObj = await User.findOne({ username: user }).exec();
        if (userObj) {
          userID.push(userObj); // Add user object to the array
        }
      } catch (err) {
        console.error(`Error fetching user with username ${user}:`, err);
      }
    }

    res.render('home', {
      allUsers,
      usersChattedWith, // Pass the chatted users to the view
      dedUser,
      messages,
      loggedInUser: req.user.username,
      userID
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).send('Server Error');
  }
});


app.get('/chat/:id', authenticateToken, async (req, res) => {
  try {
    const dedUser = await User.findOne({ id: req.params.id });
    if (!dedUser) return res.status(404).send('User not found');

    const allUsers = await fetchAllUsers();
    const messages = await Message.find({
      $or: [
        { from: req.user.username, to: dedUser.username },
        { from: dedUser.username, to: req.user.username },
      ],
    }).sort({ _id: 1 });

    res.render('home', {
      allUsers,
      dedUser,
      messages,
      loggedInUser: req.user.username,
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).send('Server Error');
  }
});

app.get('/signin', (req, res) => {
  res.render('login');
});

app.post('/submit', async (req, res) => {
  const { username } = req.body;
  try {
    let user = await User.findOne({ username });
    if (!user) user = await User.create({ username });

    const token = jwt.sign({ username: user.username }, SECRET_KEY, {
      expiresIn: '24h',
    });
    res.cookie('auth_token', token, { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 });
    res.redirect('/');
  } catch (err) {
    res.status(500).send('Error occurred');
    console.error('Error:', err);
  }
});

server.listen(1000, () => console.log('Server started on port 1000'));
