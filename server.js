'use strict';

const path = require('path');
const express = require('express');
const { attachRoutes } = require('./lib/routes');

const app = express();
app.disable('x-powered-by');
app.use(express.urlencoded({ extended: true }));
app.use('/favicon.ico', (req, res) => res.status(204).end());
app.use(express.static(path.join(__dirname, 'public')));
attachRoutes(app);

const port = process.env.PORT || 8080;
app.listen(port, () => console.log('Customer Experience Library listening on port ' + port));
