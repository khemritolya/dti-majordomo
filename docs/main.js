function endpoint() {
    this.list = ["CoursePlan_EndPoint1", "CoursePlan_EndPoint2", "CUReview_EndPoint1", "Flux_EndPoint1"];
}

function populate(sourceString){
    var myList = document.getElementById(sourceString);
    var sourceObject = eval(sourceString);
    var obj = new sourceObject();
    var options = '';
    for(var i=0; i<obj.list.length; i++){
        options+= '<option value = "'+obj.list[i] + '" />';
    }
    
    myList.innerHTML = options;
}