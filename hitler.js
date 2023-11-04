/* global Infinity */

var express = require('express');
var app = express();
var serv = require('http').Server(app);
 
app.get('/',function(req, res) {
    res.sendFile(__dirname + '/client/index.html');
});
app.use('/client',express.static(__dirname + '/client'));
 
var PORT = process.env.PORT || 11157;
serv.listen(PORT);
console.log("Secret Hitler server started. Port: 11157");

var SOCKET_LIST = {};
var ROOM_LIST = [];
ROOM_LIST[0] = new Room("default", "" , 999 , true);
var DEBUG = true;

PRELOBBYROOM = new Room("prelobby","", 999, true);



//SOCKET
///////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////
var io = require('socket.io')(serv,{});
io.sockets.on('connection', function(socket){
    socket.id = Math.random();
    socket.username = "";
    SOCKET_LIST[socket.id] = socket;
    socket.room = PRELOBBYROOM;
    //DEBUG
    socket.on("evalServer",function(data){
        if(!DEBUG)
            return;
        var res = eval(data);
        socket.emit("evalAnswer",res);     
    });
    
    
    //Signing In/Out///////////////////////////////////////////
    socket.on("signIn",function(data){
            if(isUsernameTaken(data)){
                socket.emit("signInResponse",{success:false});     
            } else {
                socket.username = data.username;
                /*socket.room = ROOM_LIST[0];
                socket.room.playerList[socket.id] = socket;
                joinLeaveMessage("join", socket.room, socket.username, socket);
                refreshUserChat(socket.room);
                refreshRoomName(socket);
                refreshRoomList();*/
                socket.emit("joinRoom",0,"");
                socket.emit("signInResponse",{success:true});
            }
    });
    socket.on("disconnect",function(){
        delete SOCKET_LIST[socket.id];
        delete socket.room.playerList[socket.id];
        refreshUserChat(socket.room);
        if(socket.username !== ""){
            for(var i in socket.room.playerList){
                socket.room.playerList[i].emit("addToChat",socket.username+" has left!");
            }
        }
        refreshRoomList();
    });
    //Chat /////////////////////////////////////////////////
    socket.on("chatToEveryone",function(data){
        for(var i in socket.room.playerList){
            socket.room.playerList[i].emit("addToChat",socket.username + ": " + data);
        }
    });
    
    //ROOMS ///////////////////////////////////////////////
    socket.on("joinRoom",function(data,pw){
        if(pw === ROOM_LIST[data].password){
            socket.emit("toggleRoomList",ROOM_LIST[data].name);
        
            //Leave Old Room
            delete socket.room.playerList[socket.id];
            refreshUserChat(socket.room);
            joinLeaveMessage("leave", socket.room, socket.username, socket);
            //Join New Room
            ROOM_LIST[data].playerList[socket.id] = socket;
            socket.room = ROOM_LIST[data]; 
            joinLeaveMessage("join", socket.room, socket.username, socket);
            refreshUserChat(socket.room);
            refreshRoomName(socket);
            if(socket.room.hasStarted){
                socket.emit("startGame");
                refreshBoard(socket.room);
            }
            refreshRoomList();
        }else{
            socket.emit("enterRoomPassword",data);
        }
    });
    
    socket.on("createRoom", function(name, pw,presidentPowerArray){
        var newRoom = ROOM_LIST.push(new Room(name,pw,10,true,presidentPowerArray));
        socket.emit("joinRoom",newRoom-1,pw);
    });
    
    socket.on("checkRoomNames",function(name,pw,presidentPowerArray){
        for(var i=0;i<ROOM_LIST.length;i++){
            if(name === ROOM_LIST[i].name){
                socket.emit("createRoomFinal",false,name,pw);
                return;
            }
        }
        socket.emit("createRoomFinal",true,name,pw,presidentPowerArray);
    });
    
    socket.on("startGame", function(){
        var totalPlayers = 0;
        for(var i in socket.room.playerList){
            totalPlayers++;
        }
        if(totalPlayers < 5){
            socket.emit("addToChat","At least 5 Players required!");
            return;
        }
        if(totalPlayers > 10){
            socket.emit("addToChat","No more than 10 Players allowed!");
            return;
        }
        for(var i in socket.room.playerList){
            socket.room.playerList[i].emit("startGame");
        } 
        socket.room.hasStarted = true;
        newGame(socket.room,true);
    });
    
    socket.on('error',function(er){
        console.log(er);
    });
    
    
    //GAME
    socket.on("chooseChancellor",function(chancellorToBe){
        if(socket.room.state === "choosingChancellor" && getPlayerObj(socket.room,socket.username).president){
            socket.room.playingPlayers[chancellorToBe].chancellor = true;
            for(var i=0;i<socket.room.playingPlayers.length;i++){
                socket.room.playingPlayers[i].vote = "";
            }
            socket.room.state = "voting";
            refreshBoard(socket.room);
			socket.room.timer = 0;
        }
    });
    
    socket.on("voted",function(who,result){
        if(socket.room.state === "voting" && getPlayerObj(socket.room,socket.username).vote === ""){
            socket.room.playingPlayers[who].vote = result;
            checkVotes(socket.room);
            refreshBoard(socket.room);
        }
    });
    
    socket.on("presidentDiscarded",function(cardID){
        if(socket.room.state === "presidentSelectingCards" && getPlayerObj(socket.room,socket.username).president){
            socket.room.drawPileArray.splice(cardID,1);
            socket.room.discardPile++;
            socket.room.state = "chancellorSelectingCards";
			socket.room.timer = 0;
            refreshBoard(socket.room);
        }
    });
    
    socket.on("chancellorEnacted",function(cardID){
        if(socket.room.state === "chancellorSelectingCards" && getPlayerObj(socket.room,socket.username).chancellor){
            socket.room.justVetoed = false;
            var cardFaction = socket.room.drawPileArray[cardID];
            playCard(socket.room,socket.room.drawPileArray[cardID],true);
            socket.room.drawPileArray.splice(0,2);
            socket.room.discardPile++;
            checkDrawPile(socket.room);
            if(socket.room.state !== "gameover"){
                //CHECK IF PRESIDENT POWERS SHOULD BE STARTED HERE
                if(cardFaction === false && socket.room.presidentPowers[socket.room.fascistEnacted-1] !== ""){
                    socket.room.state = socket.room.presidentPowers[socket.room.fascistEnacted-1];
                }else{
                    newPresident(socket.room,-1,"success");
                }
            }
			socket.room.timer = 0;
            refreshBoard(socket.room);
        }
    });
    
    socket.on("lookAtTopThreeDone",function(){
        if(socket.room.state === "lookAtTopThree" && getPlayerObj(socket.room,socket.username).president){
            newPresident(socket.room,-1,"success");
			socket.room.timer = 0;
            refreshBoard(socket.room);
        }
    });
    
    socket.on("killPlayer",function(playerID){
        if(socket.room.state === "kill" && getPlayerObj(socket.room,socket.username).president){
            for(var i in socket.room.playerList){
                socket.room.playerList[i].emit("editRightNews",socket.username + " killed " + socket.room.playingPlayers[playerID].name +"</br> <span style='font-size: 70%'> Vengeance? Justice? </span> </br> <span style='font-size: 50%'> Fire and Blood. </br>");
            }
            socket.room.playingPlayers[playerID].dead = true;
            checkForLastPlayerRemaining(socket.room);
            if(socket.room.playingPlayers[playerID].hitler){
                socket.room.state = "gameover";
                socket.room.won = "liberal";
                for(var i in socket.room.playerList){
                    socket.room.playerList[i].emit("addToChat", "Hitler has been killed. </br> Liberals Win!");
                }
                uploadScore(socket.room);
            }


            if(socket.room.state !== "gameover"){
                newPresident(socket.room,-1,"success");
                socket.room.playingPlayers[playerID].notHitlerConfirmed = true;
            }
			socket.room.timer = 0;
            refreshBoard(socket.room);
        }
    });
    
    socket.on("selectPresident",function(playerID){
        if(socket.room.state === "pickPresident" && getPlayerObj(socket.room,socket.username).president){
            newPresident(socket.room,playerID,"success");
            refreshBoard(socket.room);
            for(var i in socket.room.playerList){
                socket.room.playerList[i].emit("addToChat", socket.username + " picked " + socket.room.playingPlayers[playerID].name + " as the new President.");
            }
			socket.room.timer = 0;
        }
    });
    
    socket.on("investigate",function(playerID){
        if(socket.room.state === "investigate" && getPlayerObj(socket.room,socket.username).president){
            if(socket.room.playingPlayers[playerID].fascist){
                socket.emit("addToChat", socket.room.playingPlayers[playerID].name + " is a Fascist.");
            }else{
                socket.emit("addToChat", socket.room.playingPlayers[playerID].name + " is a Liberal.");
            }
            for(var i in socket.room.playerList){
                if(socket.room.playerList[i] === socket){
                    continue;
                }
                socket.room.playerList[i].emit("addToChat", socket.username + " just investigated " + socket.room.playingPlayers[playerID].name + "'s Identity.");
            }
            newPresident(socket.room,-1,"success");
			socket.room.timer = 0;
            refreshBoard(socket.room);
        }
    });
    
    socket.on("requestVeto",function(){
        if(socket.room.state === "chancellorSelectingCards" && getPlayerObj(socket.room,socket.username).chancellor){
            socket.room.state = "requestingVeto";
            socket.room.justVetoed = true;
            refreshBoard(socket.room);
        }
    });
    
    socket.on("vetoAnswer",function(data){
        if(socket.room.state === "requestingVeto" && getPlayerObj(socket.room,socket.username).president){
            if(data){
                socket.room.justVetoed = false;
                socket.room.drawPileArray.splice(0,2);
                socket.room.discardPile+=2;
                checkDrawPile(socket.room);
                socket.room.electionTracker++;
                checkElectionTracker(socket.room);
                if(socket.room.state !== "gameover"){
                    newPresident(socket.room,-1,"fail");
                }
            }else{
                socket.room.state = "chancellorSelectingCards";
            }
            refreshBoard(socket.room);
        }
    });
    
    socket.on("newGame",function(){
        for(var i in socket.room.playerList){
            socket.room.playerList[i].emit("addToChat", socket.username + " has started a new game.");
        }
        newGame(socket.room,true);
    });
    
    
});
////////////////////////////////////////////////////////////////////////////////
//GLOBAL////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////
var isUsernameTaken = function(data){
    var taken = false;
        for(var i in SOCKET_LIST){
                if(SOCKET_LIST[i].username === data.username) taken = true;
        }
    return taken;
};

//Chat Methods
var refreshUserChat = function(room){
    for(var i in room.playerList){
            room.playerList[i].emit("clearUserChat");
            for(var j in room.playerList){
                    var name = room.playerList[j].username;
                    room.playerList[i].emit("addToUserChat",name);
            }
    }
};

//ROOM
function Room(name, password, maxPlayers, isOpen, presidentPowerArray) {
    this.name = name;
    this.password = password;
    this.maxPlayers = maxPlayers;
    this.isOpen = isOpen;
    
    
    
    this.playerList = {}; //These are the sockets : [socket.id] = socket
    
    //EDIT this and you also need to edit, newGame() and removePlayerList();
    
    //Game
    this.hasStarted = false;
    this.playingPlayers = []; //these are the player objects
    this.drawPile = 17;
    this.discardPile = 0;
    this.liberalEnacted = 0;
    this.fascistEnacted = 0;
    this.electionTracker = 0;
    this.won = "";
    if(presidentPowerArray !== null){
        this.presidentPowers = presidentPowerArray;
    }else{
        this.presidentPowers = [];
    }
    this.justVetoed = false;
    
    this.drawPileArray = [true,true,true,true,true,true,false,false,false,false,false,false,false,false,false,false,false];
    
    //States, choosing Chancellor, Voting, President is Choosing, Chancellor is Choosing, (All President Powers)
    this.state = "choosingChancellor";
	
	this.timer = 0;
};

function Player(name){
    this.name = name;
    this.dead = false;
    this.president = false;
    this.previousPresident = false;
    this.fascist = false;
    this.hitler = false;
    this.chancellor = false; //needed?
    this.previousChancellor = false;
    this.vote = ""; //ja nein
    this.notHitlerConfirmed = false;
};

    
var refreshRoomList = function(){
    checkForEmptyRooms(); //IMPORTANT refreshRoomList calls checkforEmptyRooms -> destroying unused rooms
    var sendRoomList = [];
    for(var i=0;i<ROOM_LIST.length;i++){
        var playerAmount = 0;
        for(var j in ROOM_LIST[i].playerList){
            playerAmount ++;
        }
        sendRoomList[i] = {name: ROOM_LIST[i].name, password: ROOM_LIST[i].password, maxPlayers: ROOM_LIST[i].maxPlayers, isOpen: ROOM_LIST[i].isOpen, currentPlayerAmount: playerAmount};
    }
    
    for(var i in ROOM_LIST[0].playerList){
        ROOM_LIST[0].playerList[i].emit("fillRoomList",sendRoomList);
    }
};

var joinLeaveMessage = function(joinLeave, room, name, myself){
    var message = "";
    if(joinLeave === "join"){
        message = " has joined ";
    }else{
        message = " has left ";
    }
    for(var i in room.playerList){
        if(room.playerList[i] === myself){
            continue;
        }
        room.playerList[i].emit("addToChat", name + message + room.name + ".");
    }
};

var refreshRoomName = function (socket){
    socket.emit("refreshRoomName", socket.room.name);
};

var checkForEmptyRooms = function(){
    for(var i=1;i<ROOM_LIST.length;i++){
        var playerAmount = 0;
        for(var j in ROOM_LIST[i].playerList){
            playerAmount ++;
        }
        if(playerAmount == 0){
            ROOM_LIST.splice(i,1);
            refreshRoomList();
            break;
        }
    }
};

///////////////////////////////////////////////////////////////////////////////
//GAME/////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////

var newGame = function(room,freshGame){
    var isFreshGame = false;
    if(freshGame !== undefined){
        isFreshGame = true;
    }
    
    room.playingPlayers = playerListToArray(room.playerList);
    room.drawPile = 17;
	room.timer = 0;
    room.discardPile = 0;
    room.liberalEnacted = 0;
    room.fascistEnacted = 0;
    room.electionTracker = 0;
    room.state = "choosingChancellor";
    room.drawPileArray = newDrawPile(6,11);
    room.won = ""; // fascist or liberal if they won
    if(room.presidentPowers.length <= 0){
        room.presidentPowers = defaultPresidentPowers(room.playingPlayers.length);
    }else{
        for(var i in room.playerList){
            room.playerList[i].emit("addToChat", "Custom President Powers for this Game are: <br>" + getPresidentPowerString(room.presidentPowers));
        }
    }
    room.justVetoed = false;
    
    assignFascistsAndHitler(room.playingPlayers);
    assignInitialPresident(room.playingPlayers);
    
    refreshBoard(room,isFreshGame);
};

var getPresidentPowerString = function(presidentPowerArray){
    var string = "";
    for(var i=0;i<5;i++){
        if(presidentPowerArray[i] === ""){
            string += "none ";
        }else{
            string += presidentPowerArray[i] + " ";
        }
        if(i<4){
            string += ",";
        }
    }
    return string;
};

var refreshBoard = function(room, freshGame){
    var isFreshGame = false;
    if(freshGame !== undefined){
        isFreshGame = true;
    }
    for(var i in room.playerList){
        var roomToSend = removePlayerList(room);
        var playerObjImSendingTo = getPlayerObj(roomToSend,room.playerList[i].username);
        
        //removing DrawPile for the ppl who are not supposed to see
        if(playerObjImSendingTo !== null){ //I'm playing
            if((roomToSend.state === "lookAtTopThree" || roomToSend.state === "presidentSelectingCards") && playerObjImSendingTo.president){
                roomToSend = removeDrawPile(roomToSend,3);
            }else if(roomToSend.state === "chancellorSelectingCards" && playerObjImSendingTo.chancellor){
                roomToSend = removeDrawPile(roomToSend,2);
            }else{
                roomToSend = removeDrawPile(roomToSend,0);
            }
        }else{
            roomToSend = removeDrawPile(room,0);
        }
        //remove info about other roles for ppl who are not supposed to see
        if(roomToSend.state !== "gameover"){
            if(playerObjImSendingTo !== null){
                if(!playerObjImSendingTo.fascist || (playerObjImSendingTo.hitler && roomToSend.playingPlayers.length >= 7)){
                    roomToSend = removeOtherPlayerRoles(roomToSend,room.playerList[i].username);
                }
            }else{
                roomToSend = removeOtherPlayerRoles(roomToSend,room.playerList[i].username);
            }
        }
        
        
        
        
        //create Function DoINeedToKnowAboutOtherPlayers(username) createFunction newRoom = removeInfoAboutOtherPlayers(room)
        //also remove info about DrawPile
        //room.playerList[i].username is players username im sending to
        room.playerList[i].emit("refreshBoard",roomToSend,isFreshGame);
    }
};

var playerListToArray = function(obj){
    var newArray = [];
    for(var i in obj){
        newArray.push(new Player(obj[i].username));
    }
    return newArray;
};

var assignFascistsAndHitler = function(playingPlayers){
    var fascistAmount = Math.ceil(playingPlayers.length / 2) - 1;
    if(fascistAmount === 0){
        fascistAmount = 1;
    }

    var IDs = [];
    for(var i=0;i<playingPlayers.length;i++){
        IDs.push(i);
    }
    
    var fascistArray = [];
    for(var i=0;i<fascistAmount;i++){
        var randomID = randomRange(0,IDs.length-1);
        playingPlayers[IDs[randomID]].fascist = true; 
        fascistArray.push(IDs[randomID]);
        IDs.splice(randomID,1);
    }
    
    var hitlerID = fascistArray[randomRange(0,fascistArray.length-1)];
    playingPlayers[hitlerID].hitler = true;
};

var assignInitialPresident = function(playingPlayers){
    playingPlayers[randomRange(0,playingPlayers.length-1)].president = true;
};

var checkVotes = function(room){
    var jaCount = 0;
    var totalPlayers = 0;
    var chancellorID = -1;
    for(var i=0;i<room.playingPlayers.length;i++){
        if(room.playingPlayers[i].vote === "" && !room.playingPlayers[i].dead){ //If not everyone has voted return
            return;
        }
    }
    for(var i=0;i<room.playingPlayers.length;i++){
        if(room.playingPlayers[i].vote === "ja"){
            jaCount++;
        }
        if(room.playingPlayers[i].chancellor){
            chancellorID = i;
        }
        if(!room.playingPlayers[i].dead){
            totalPlayers++;
        }
    }
    
    if(jaCount > totalPlayers/2){
        //Election Successful
        if(room.fascistEnacted >= 3){
            if(room.playingPlayers[chancellorID].hitler){
                room.won = "fascist";
                room.state = "gameover";
                uploadScore(room);
                for(var i in room.playerList){
                    room.playerList[i].emit("addToChat", "Hitler as been elected as Chancellor after 3 Fascist Policies were enacted. </br> Fascists Win!");
                }
            }else{
                room.playingPlayers[chancellorID].notHitlerConfirmed = true;
            }
        }
        if(room.state !== "gameover"){
            room.state = "presidentSelectingCards";
            room.drawPile -= 3;
        }
    }else{
        //Election Failed
        room.electionTracker++;
        checkElectionTracker(room);
        if(room.state !== "gameover"){
            //Change president and chancellor and state
            newPresident(room,-1,"fail");
        }
    }
	room.timer = 0;
    refreshBoard(room);
};

var checkElectionTracker = function(room){
    if(room.electionTracker >= 3){
        playCard(room,room.drawPileArray.shift(),false);
        room.drawPile--;
        checkDrawPile(room);
        room.electionTracker = 0;
        for(var i=0;i<room.playingPlayers.length;i++){
            room.playingPlayers[i].previousPresident = false;
            room.playingPlayers[i].previousChancellor = false;
        }
    }
    
    refreshBoard(room);
};

var newDrawPile = function(liberal,fascist){
    var newArray = [];
    for(var i=0;i<liberal;i++){
        newArray.push(true);
    }
    for(var i=0;i<fascist;i++){
        newArray.push(false);
    }
    shuffleArray(newArray);
    return newArray;
};

var playCard = function(room,card,election){
    var presidentName = "";
    var chancellorName = "";
    for(var i=0;i<room.playingPlayers.length;i++){
        if(room.playingPlayers[i].president){
            presidentName = room.playingPlayers[i].name;
        }else if(room.playingPlayers[i].chancellor){
            chancellorName = room.playingPlayers[i].name;
        }
    }
    if(card === true){
        room.liberalEnacted++;
        if(election){
            for(var i in room.playerList){
                room.playerList[i].emit("editLeftNews","<p> <span style='color: blue'> President " + presidentName + " </span> and <span style='color:salmon'> Chancellor " + chancellorName + " </span> enacted a <span style='color:dodgerblue'> Liberal Policy </span> </p>");
            }
        }else{
            for(var i in room.playerList){
                room.playerList[i].emit("editLeftNews","<p> The Populace enacted a <span style='color:dodgerblue'> Liberal Policy </span> </p>");
            }
        }
    }else{
        room.fascistEnacted++;
        if(election){
            for(var i in room.playerList){
                room.playerList[i].emit("editLeftNews","<p> <span style='color: blue'> President " + presidentName + " </span> and <span style='color:salmon'> Chancellor " + chancellorName + " </span> enacted a <span style='color:red'> Fascist Policy </span> </p>");
            }
        }else{
            for(var i in room.playerList){
                room.playerList[i].emit("editLeftNews","<p> The Populace enacted a <span style='color:red'> Fascist Policy </span> </p>");
            }
        }
    }
    if(room.liberalEnacted >= 5){
        room.won = "liberal";
        room.state = "gameover";
        uploadScore(room);
        for(var i in room.playerList){
            room.playerList[i].emit("addToChat", "5 Liberal Policies were enacted. </br> Liberals Win!");
        }
    }else if(room.fascistEnacted >= 6){
        room.won = "fascist";
        room.state = "gameover";
        uploadScore(room);
        for(var i in room.playerList){
            room.playerList[i].emit("addToChat", "6 Fascist Policies were enacted. </br> Fascists Win!");
        }
    }
};

var newPresident = function(room,id,electionResult){
    //Move current to previous
    var currentPresidentID = -1;
    var totalPlayers = 0;
    if(electionResult === "success"){
        room.electionTracker = 0;
        for(var i=0;i<room.playingPlayers.length;i++){
            room.playingPlayers[i].previousPresident = false;
            room.playingPlayers[i].previousChancellor = false;
        }
    }
    
    for(var i=0;i<room.playingPlayers.length;i++){
        totalPlayers++;
        if(room.playingPlayers[i].president){
            currentPresidentID = i;
            if(electionResult === "success"){
                room.playingPlayers[i].previousPresident = true;
            }
            room.playingPlayers[i].president = false;
        }
        if(room.playingPlayers[i].chancellor && electionResult === "success"){
            room.playingPlayers[i].previousChancellor = true;
        }
        room.playingPlayers[i].chancellor = false;
    }
    
    if(id === -1){ //Next President in line
        //Doesnt work for 2 Players! 
        do{
            if((totalPlayers % 2) === 0){ //is even
                if((currentPresidentID+2) === totalPlayers-1){
                  currentPresidentID+=2;
                }else if(currentPresidentID === (totalPlayers-1)){
                  currentPresidentID=0;
                }else{
                  currentPresidentID = (currentPresidentID+2) % (totalPlayers-1);
                }
            }else{
            currentPresidentID = (currentPresidentID+2) % totalPlayers;
            }
        }while(room.playingPlayers[currentPresidentID].dead)
        
        room.playingPlayers[currentPresidentID].president = true;
    }else{
        room.playingPlayers[id].president = true;
    }
    
    room.state = "choosingChancellor";
};

var checkDrawPile = function(room){
    if(room.drawPileArray.length < 3){
        room.discardPile = 0;
        room.drawPile = 17 - (room.liberalEnacted + room.fascistEnacted);
        room.drawPileArray = newDrawPile(6 - room.liberalEnacted, 11 - room.fascistEnacted);
    }
};

var defaultPresidentPowers = function(totalPlayers){
    var newPowerArray = [];
    if(totalPlayers <= 6){
        newPowerArray[0] = "";
        newPowerArray[1] = "";
        newPowerArray[2] = "lookAtTopThree";
        newPowerArray[3] = "kill";
        newPowerArray[4] = "kill";
    }else if(totalPlayers === 7 || totalPlayers === 8){
        newPowerArray[0] = "";
        newPowerArray[1] = "investigate";
        newPowerArray[2] = "pickPresident";
        newPowerArray[3] = "kill";
        newPowerArray[4] = "kill";
    }else if(totalPlayers >= 9){
        newPowerArray[0] = "investigate";
        newPowerArray[1] = "investigate";
        newPowerArray[2] = "pickPresident";
        newPowerArray[3] = "kill";
        newPowerArray[4] = "kill";
    }
    return newPowerArray;
};

var checkForLastPlayerRemaining = function(room){
    var alivePlayers = 0;
    var aliveFaction;
    for(var i=0;i<room.playingPlayers.length;i++){
        if(!room.playingPlayers[i].dead){
            alivePlayers++;
            aliveFaction = room.playingPlayers[i].fascist;
        }
    }
    if(alivePlayers <= 1){
        room.state = "gameover";
        if(aliveFaction){
            room.won = "fascist";
        }else{
            room.won = "liberal";
        }
        uploadScore(room);
    }
};


var uploadScore = function(room){
    var whoWon;
    if(room.won === "liberal"){
        whoWon = false;
    }else if(room.won === "fascist"){
        whoWon = true;
    }else{
        console.log("This shouldn't happen!");
    }
    
    var query = "";
    for(var i=0;i<room.playingPlayers.length;i++){
        var secondaryWinSection = "";
        if(room.playingPlayers[i].fascist){
            secondaryWinSection += "fascist";
        }else{
            secondaryWinSection += "liberal";
        }
        
        
        if(room.playingPlayers[i].fascist === whoWon){ //I Won
            secondaryWinSection += "Wins";
            query += "INSERT INTO hitlerLeaderboards(username,wins,losses,liberalWins,liberalLosses,fascistWins,fascistLosses) values('" + room.playingPlayers[i].name + "',1,0,0,0,0,0) ON DUPLICATE KEY UPDATE wins = wins+1;";
        }else{
            secondaryWinSection += "Losses";
            query += "INSERT INTO hitlerLeaderboards(username,wins,losses,liberalWins,liberalLosses,fascistWins,fascistLosses) values('" + room.playingPlayers[i].name + "',0,1,0,0,0,0) ON DUPLICATE KEY UPDATE losses = losses+1;";
        }
        
        
            query += "UPDATE hitlerLeaderboards SET " + secondaryWinSection + "=" + secondaryWinSection + " + 1 WHERE username = '" + room.playingPlayers[i].name + "';";
    }
    
    
    var mysql      = require('mysql');
    var connection = mysql.createConnection({
        host     : process.env.db_host,
        user     : process.env.db_user,
        password : process.env.db_pw,
        database : process.env.db_name,
        multipleStatements: true
    });

    connection.connect();

    connection.query(query, function(err) {
      if (!err)
        console.log('The solution is: ');
      else
        console.log('Error while performing Query.');
        console.log('My Query' + query);
        console.log(err);
    });

    connection.end(); 
};

//UTILIY
var randomRange = function(min,max){
    return Math.floor(Math.random() * (max - min + 1)) + min;
};

var getPlayerObj = function(room,username){
    for(var i in room.playingPlayers){
        if(username === room.playingPlayers[i].name){
            return room.playingPlayers[i];
        }
    }
    return null;
};

var removeRoles = function(playerObj,removeRoles){
    var newPlayerObj = {};
    newPlayerObj.name = playerObj.name;
    newPlayerObj.dead = playerObj.dead;
    newPlayerObj.president = playerObj.president;
    newPlayerObj.previousPresident = playerObj.previousPresident;
    
    if(removeRoles){
        newPlayerObj.fascist = null;
        newPlayerObj.hitler = null;
    }else{
        newPlayerObj.fascist = playerObj.fascist;
        newPlayerObj.hitler = playerObj.hitler;
    }
    
    newPlayerObj.chancellor = playerObj.chancellor; //needed?
    newPlayerObj.previousChancellor = playerObj.previousChancellor;
    newPlayerObj.vote = playerObj.vote; //ja nein
    newPlayerObj.notHitlerConfirmed = playerObj.notHitlerConfirmed;
    
    return newPlayerObj;
};

var removeOtherPlayerRoles = function(room,username){
    //To avoid "Stack Overflow" when sending this over the network
    var newObj = {};
    newObj.name = room.name;
    newObj.password = room.password;
    newObj.maxPlayers = room.maxPlayers;
    newObj.isOpen = room.isOpen;
    
    newObj.hasStarted = room.hasStarted;
    //newObj.playingPlayers = room.playingPlayers; //it's by reference, issue?
    
    var newPlayingPlayers = [];
    for(var i in room.playingPlayers){
        if(room.playingPlayers[i].name !== username){//its not me im sending to
            newPlayingPlayers[i] = removeRoles(room.playingPlayers[i],true);
        }else{
            newPlayingPlayers[i] = removeRoles(room.playingPlayers[i],false);
        }
    }
    newObj.playingPlayers = newPlayingPlayers;
    
    newObj.drawPile = room.drawPile;
    newObj.discardPile = room.discardPile;
    newObj.liberalEnacted = room.liberalEnacted;
    newObj.fascistEnacted = room.fascistEnacted;
    newObj.electionTracker = room.electionTracker;
    
    newObj.drawPileArray = room.drawPileArray;
    newObj.won = room.won;
    newObj.presidentPowers = room.presidentPowers;
    newObj.justVetoed = room.justVetoed;
    
    //States, choosing Chancellor, President is Choosing, Chancellor is Choosing, (All President Powers)
    newObj.state = room.state;
    
    return newObj;
};

var removeDrawPile = function(room,cardsRemain){
    var newObj = {};
    newObj.name = room.name;
    newObj.password = room.password;
    newObj.maxPlayers = room.maxPlayers;
    newObj.isOpen = room.isOpen;
    
    newObj.hasStarted = room.hasStarted;
    newObj.playingPlayers = room.playingPlayers; //it's by reference, issue?
    newObj.drawPile = room.drawPile;
    newObj.discardPile = room.discardPile;
    newObj.liberalEnacted = room.liberalEnacted;
    newObj.fascistEnacted = room.fascistEnacted;
    newObj.electionTracker = room.electionTracker;
    
    //newObj.drawPileArray = room.drawPileArray;
    var newDrawPileArray = [];
    for(var i=0;i<cardsRemain;i++){
        newDrawPileArray[i] = room.drawPileArray[i];
    }
    newObj.drawPileArray = newDrawPileArray;
    
    newObj.won = room.won;
    newObj.presidentPowers = room.presidentPowers;
    newObj.justVetoed = room.justVetoed;
    
    //States, choosing Chancellor, President is Choosing, Chancellor is Choosing, (All President Powers)
    newObj.state = room.state;
    
    return newObj;
};

var removePlayerList = function(room){
    //To avoid "Stack Overflow" when sending this over the network
    var newObj = {};
    newObj.name = room.name;
    newObj.password = room.password;
    newObj.maxPlayers = room.maxPlayers;
    newObj.isOpen = room.isOpen;
    
    newObj.hasStarted = room.hasStarted;
    newObj.playingPlayers = room.playingPlayers; //it's by reference, issue?
    newObj.drawPile = room.drawPile;
    newObj.discardPile = room.discardPile;
    newObj.liberalEnacted = room.liberalEnacted;
    newObj.fascistEnacted = room.fascistEnacted;
    newObj.electionTracker = room.electionTracker;
    
    newObj.drawPileArray = room.drawPileArray;
    newObj.won = room.won;
    newObj.presidentPowers = room.presidentPowers;
    newObj.justVetoed = room.justVetoed;
    
    //States, choosing Chancellor, President is Choosing, Chancellor is Choosing, (All President Powers)
    newObj.state = room.state;
    
    return newObj;
};

var shuffleArray = function(array){
  var currentIndex = array.length, temporaryValue, randomIndex;

  // While there remain elements to shuffle...
  while (0 !== currentIndex) {

    // Pick a remaining element...
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex -= 1;

    // And swap it with the current element.
    temporaryValue = array[currentIndex];
    array[currentIndex] = array[randomIndex];
    array[randomIndex] = temporaryValue;
  }

  return array;
};


var checkForEmptyRooms = function(){
    for(var i=1;i<ROOM_LIST.length;i++){
        var playerAmount = 0;
        for(var j in ROOM_LIST[i].playerList){
            playerAmount ++;
        }
        if(playerAmount == 0){
            ROOM_LIST.splice(i,1);
            refreshRoomList();
            break;
        }
    }
};

setInterval(function(){
    for(var i=1;i<ROOM_LIST.length;i++){
		ROOM_LIST[i].timer++;
	}
},1000);

setInterval(function(){
	for(var i=1;i<ROOM_LIST.length;i++){
		for(var j in ROOM_LIST[i].playerList){
			ROOM_LIST[i].playerList[j].emit('refreshTimer', ROOM_LIST[i].timer);
		}
	}
},10);


//NOTES
//After a Special Election, the Presidency returns to its original order. currently not should it be?
//room list showing if game in progress and only playing players

//right when third election fails -> play card? or after 4th?

//vote could still be read on client by setting breakpoint

/*TypeError: Cannot set property 'vote' of undefined
    at Socket.<anonymous> (C:\Users\Tobi\Desktop\SecretHitler\hitler.js:148:46)
    at emitTwo (events.js:106:13)
    at Socket.emit (events.js:191:7)
    at Socket.onevent (C:\Users\Tobi\Desktop\SecretHitler\node_modules\socket.io
\lib\socket.js:335:8)
    at Socket.onpacket (C:\Users\Tobi\Desktop\SecretHitler\node_modules\socket.i
o\lib\socket.js:295:12)
    at Client.ondecoded (C:\Users\Tobi\Desktop\SecretHitler\node_modules\socket.
io\lib\client.js:193:14)
    at Decoder.Emitter.emit (C:\Users\Tobi\Desktop\SecretHitler\node_modules\soc
ket.io\node_modules\socket.io-parser\node_modules\component-emitter\index.js:134
:20)
    at Decoder.add (C:\Users\Tobi\Desktop\SecretHitler\node_modules\socket.io\no
de_modules\socket.io-parser\index.js:247:12)
    at Client.ondata (C:\Users\Tobi\Desktop\SecretHitler\node_modules\socket.io\
lib\client.js:175:18)
    at emitOne (events.js:96:13)*/