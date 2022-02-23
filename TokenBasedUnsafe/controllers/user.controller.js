const User = require("../models/user.model");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const redis = require("../redis/index");

let privateKey = process.env.PRIVATE_KEY.replace(/\\n/g, '\n');
let publicKey = process.env.PUBLIC_KEY.replace(/\\n/g, '\n');

let accessTokenSignOptions = {
    issuer:  "KS",
    subject:  "jwt",
    audience:  "users",
    expiresIn: 900,
    algorithm:  "RS256"
};

let refreshTokenSignOptions = {
    issuer:  "KS",
    subject:  "jwt",
    audience:  "users",
    expiresIn: 3900,
    algorithm:  "RS256"
}

let refreshTokenVerifyOptions = {
    issuer:  "KS",
    subject:  "jwt",
    audience:  "users",
    expiresIn: 3900,
    algorithm:  ["RS256"]
}

/**
 * REGISTERING A USER INTO THE DATABASE
 * @param {Object} req 
 * @param {Obejct} res 
 * @param {Function} next 
 */
const registerUser = async(req, res, next) => {
    try {
        let {username, email, password} = req.body;
        const foundUser = await User.findOne({where: {username}});
        if(foundUser) res.json("Username Already Exists");
        else {
            const existingUser = await User.findOne({where: {email}});
            if(existingUser) res.json("Email Already Exists");
            else {
                bcrypt.genSalt(10, (err, salt) => {
                    if(!err) 
                    {
                        bcrypt.hash(password, salt, async(err, hash) => {
                            if(err) res.json(next(err));
                            else 
                            {
                                password = hash;
                                const user = await User.create({username, email, password});
                                res.json(user);
                            }
                        });
                    }
                });
            }
        }
    }
    catch(error) {
        res.json(next(error));
    }
}

/**
 * LOGGING IN THE USER
 * @param {Object} req 
 * @param {Object} res 
 * @param {Function} next 
 */
const loginUser = async(req, res, next) => {
    try {
        let { email, password } = req.body;
        const user = await User.findOne({where: {email}});
        if(user)
        {
            bcrypt.compare(password, user.dataValues.password)
            .then((isMatch) => {
                if(!isMatch) res.json("Password is not correct");
                else 
                {
                    const accessTokendata = {id: user.dataValues.id};
                    jwt.sign(accessTokendata, privateKey, accessTokenSignOptions, (err, accessToken) => {
                        if(err) console.log(err);
                        else 
                        {
                            const refreshTokenData = {id: user.dataValues.id};
                            jwt.sign(refreshTokenData, privateKey, refreshTokenSignOptions, (err, refreshToken) => {
                                if(err) console.log(err);
                                else 
                                {
                                    console.log("ACCESS TOKEN => ", accessToken);
                                    console.log("REFRESH TOKEN => ", refreshToken);
                                    redis.setAccessToken(accessToken, refreshToken);
                                    redis.setRefreshToken(refreshToken);
                                    res.cookie("jwtToken", accessToken, {
                                        httpOnly: false,
                                        sameSite: 'None',
                                        secure: true
                                    });
                                    res.json({username: user.dataValues.username, email});
                                }
                            });       
                        }
                    });
                }
            })
            .catch((error) => {
                res.json(next(error));
            })
        }
        else res.json("Account Doesn't Exists");
    }
    catch(error) {
        res.json(next(error));
    }
}

/**
 * CHECKING THE AUTHENTICATION STATUS OF A USER
 * @param {Object} req 
 * @param {Object} res 
 * @param {Function} next 
 */
const checkAuth = async(req, res, next) => {
    try {
        if(req.user === null) {
            res.clearCookie("jwtToken");
            res.json("INVALID");
        }
        else {
            const refreshToken = await redis.getRefreshTokenFromAccessToken(req.accessToken);
            res.json({username: req.user.username, email: req.user.email, accessToken: req.accessToken, refreshToken});            
        }
    }
    catch(error) {
        res.json(next(error));
    }
}

/**
 * LOGGIN OUT THE USER
 * @param {Object} req 
 * @param {Object} res 
 * @param {Function} next 
 */
const logoutUser = async(req, res, next) => {
    try {
        console.log("MIDDLEWARE USERNAME => ", req.user.username);
        console.log("WEBSITE USERNAME => ", req.body.username);
        const user = req.user;
        if(user === null || user.username !== req.body.username) {
            res.status(401).json({Error: "You Are Not Logged In"});
        }
        else {
            const accessToken = req.cookies.jwtToken;
            console.log("ACCESS TOKEN => ", accessToken);
            const refreshToken = await redis.getRefreshTokenFromAccessToken(accessToken);
            console.log("REFRESH TOKEN => ", refreshToken);
            redis.deleteToken(accessToken);
            redis.deleteToken(refreshToken);
            res.clearCookie("jwtToken");
            res.json("Successfully Logged Out");
        }
    }
    catch(err) {
        res.json(next(err));
    }
}

/**
 * CREATING A NEW ACCESS TOKEN FROM EXISTING REFRESH TOKEN 
 * @param {Object} req 
 * @param {Object} res 
 * @param {Function} next 
 */
const renewAccessToken = async(req, res, next) => {
    try {
        console.log("MIDDLEWARE USERNAME => ", req.user.username);
        console.log("WEBSITE USERNAME => ", req.body.username);
        const user = req.user;
        if(user === null || user.username !== req.body.username || user === undefined) {
            res.status(401).json({Error: "You Are Not Logged In"});
        }
        else {
            const accessToken = req.cookies.jwtToken;
            console.log("OLD ACCESS TOKEN => ", accessToken);
            const refreshToken = await redis.getRefreshTokenFromAccessToken(accessToken);
            console.log("REFRESH TOKEN => ", refreshToken);
            jwt.verify(refreshToken, publicKey, refreshTokenVerifyOptions, async(err, payload) => {
                if(err) return err;
                else 
                {
                    const { id } = payload;
                    console.log("USER ID => ", id);
                    const accessTokendata = {id};
                    jwt.sign(accessTokendata, privateKey, accessTokenSignOptions, (err, newAccessToken) => {
                        if(err) console.log(err);
                        else 
                        {
                            console.log("NEW ACCESS TOKEN => ", newAccessToken);
                            redis.deleteToken(accessToken);
                            res.clearCookie("jwtToken");
                            redis.setAccessToken(newAccessToken, refreshToken);
                            res.cookie("jwtToken", newAccessToken, {
                                httpOnly: false,
                                sameSite: 'None',
                                secure: true
                            });
                            res.json({accessToken: newAccessToken});
                        }
                    });
                }
            });
        }
    }
    catch(err) {
        res.json(next(err));
    }
}

/**
 * FUNCTION TO UPDATE PASSWORD IN DATABASE
 * @param {Object} req 
 * @param {Object} res 
 * @param {Function} next 
 */
const changePassword = async(req, res, next) => {
    try {
        const user = req.user;
        if(user === null || user.username !== req.body.username || user === undefined) {
            res.json({message: "Error", token: req.cookies.jwtToken, user: req.user});
        }
        else {
            let { newPassword } = req.body;
            let existingUser = await User.findOne({where: {username: user.username}});
            bcrypt.genSalt(10, (err, salt) => {
                if(!err) 
                {
                    bcrypt.hash(newPassword, salt, async(err, hash) => {
                        if(err) res.json(next(err));
                        else 
                        {
                            existingUser.password = hash;
                            existingUser.save()
                            .then(() => {
                                res.json({message: "Password Changed Successfully", token: req.cookies.jwtToken});
                            })
                        }
                    });
                }
            });
        }
    }
    catch(err) {
        res.json(next(err));
    }
}

/**
 * FUNCTION TO SAVE TEXT INTO DATABASE
 * @param {Object} req 
 * @param {Object} res 
 * @param {Function} next 
 */
const saveText = async(req, res, next) => {
    try {
        const user = req.user;
        if(user === null || user.username !== req.body.username || user === undefined) {
            res.status(401).json({Error: "You Are Not Logged In"});
        }
        else {
            res.json(text);
        }
    }
    catch(err) {
        res.json(next(err));
    }
}

module.exports = { 
    registerUser, 
    loginUser, 
    checkAuth, 
    logoutUser, 
    renewAccessToken, 
    changePassword, 
    saveText 
}